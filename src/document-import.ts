import { unzip, unzipSync, type Unzipped } from 'fflate';

import {
  escapeEpubMarkdownText,
  reflowEpubChapter,
} from './epub-reflow';

type ImportedDocumentBase = {
  title?: string;
  author?: string;
  cover?: string;
};

export type ImportedDocumentSource = ImportedDocumentBase & {
  source: string;
};

export type ReadDocumentOptions = {
  onProgress?: (progress: number) => void;
};

const COVER_MAX_WIDTH = 720;
const COVER_MAX_HEIGHT = 1_024;
const MAX_EPUB_FILE_SIZE = 128 * 1024 * 1024;
const MAX_EPUB_ENTRY_COUNT = 10_000;
const MAX_EXTRACTED_ENTRY_SIZE = 24 * 1024 * 1024;
const MAX_EXTRACTED_TOTAL_SIZE = 192 * 1024 * 1024;
const MAX_MARKUP_SIZE = 8 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

const fileTitleOf = (name: string) => name
  .replace(/\.epub$/i, '')
  .trim();

const cleanMetadata = (value: unknown) => (
  typeof value === 'string'
    ? Array.from(value, (character) => {
        const code = character.codePointAt(0) ?? 0;

        return code <= 0x1f || code === 0x7f ? ' ' : character;
      }).join('').replace(/\s+/g, ' ').trim()
    : ''
);

const normalizeNewlines = (value: string) => value
  .replace(/^\uFEFF/, '')
  .replace(/\r\n?|\u2028|\u2029/g, '\n');

const hasUnsafeControls = (value: string) => (
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;

    return code === 0
      || (code >= 1 && code <= 8)
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31);
  })
);

const decodeWith = (bytes: Uint8Array, encoding: string) => (
  new TextDecoder(encoding, { fatal: true }).decode(bytes)
);

const decodeText = (bytes: Uint8Array, declaredEncoding?: string) => {
  let value: string | undefined;

  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      value = decodeWith(bytes.subarray(3), 'utf-8');
    } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      value = decodeWith(bytes.subarray(2), 'utf-16le');
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      value = decodeWith(bytes.subarray(2), 'utf-16be');
    } else if (declaredEncoding) {
      value = decodeWith(bytes, declaredEncoding);
    } else {
      value = decodeWith(bytes, 'utf-8');
    }
  } catch {
    if (declaredEncoding) {
      throw new Error(`文件不是有效的 ${declaredEncoding.toUpperCase()} 文本`);
    }

    try {
      value = decodeWith(bytes, 'gb18030');
    } catch {
      throw new Error('文件不是有效的 UTF-8、UTF-16 或 GB18030 文本');
    }
  }

  const normalized = normalizeNewlines(value);
  if (hasUnsafeControls(normalized)) {
    throw new Error('文件包含不支持的二进制控制字符');
  }
  return normalized;
};

const declaredMarkupEncoding = (bytes: Uint8Array) => {
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 1_024));
  const label = prefix.match(
    /(?:encoding\s*=\s*["']|charset\s*=\s*["']?)([a-z0-9._-]+)/i,
  )?.[1]?.toLowerCase();

  if (!label || label === 'utf8') {
    return label ? 'utf-8' : undefined;
  }
  if (label === 'gb2312' || label === 'gbk') {
    return 'gb18030';
  }
  return new Set([
    'utf-8',
    'utf-16',
    'utf-16le',
    'utf-16be',
    'gb18030',
    'big5',
    'windows-1252',
  ]).has(label)
    ? label
    : undefined;
};

const decodeMarkup = (bytes: Uint8Array) => {
  if (bytes.byteLength > MAX_MARKUP_SIZE) {
    throw new Error('EPUB 单个正文或描述文件过大');
  }
  const encoding = declaredMarkupEncoding(bytes);

  if (encoding) {
    return decodeText(bytes, encoding);
  }
  return decodeText(bytes);
};

const parseXml = (source: string, description: string) => {
  if (/<!ENTITY\b/i.test(source)) {
    throw new Error(`${description} 包含不支持的实体声明`);
  }

  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error(`${description} 格式不正确`);
  }
  return document;
};

const normalizePathSegments = (path: string, allowParentSegments: boolean) => {
  if (
    !path
    || path.includes('\\')
    || path.includes('\0')
    || path.startsWith('/')
    || /^[a-z]:/i.test(path)
  ) {
    throw new Error('EPUB 包含不安全的文件路径');
  }

  const segments: string[] = [];
  path.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return;
    }
    if (segment === '..') {
      if (!allowParentSegments || !segments.length) {
        throw new Error('EPUB 包含越界文件路径');
      }
      segments.pop();
      return;
    }
    segments.push(segment);
  });

  if (!segments.length) {
    throw new Error('EPUB 包含无效的文件路径');
  }
  return segments.join('/');
};

const zipEntryPath = (path: string) => normalizePathSegments(path, false);

const contentReferencePaths = (basePath: string, reference: string) => {
  const referencePath = reference.split(/[?#]/, 1)[0];
  if (
    !referencePath
    || referencePath.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/i.test(referencePath)
  ) {
    throw new Error('EPUB 包含不支持的外部内容引用');
  }

  const baseDirectory = basePath.includes('/')
    ? basePath.slice(0, basePath.lastIndexOf('/') + 1)
    : '';
  const rawPath = normalizePathSegments(`${baseDirectory}${referencePath}`, true);
  let decodedReference: string;

  try {
    decodedReference = referencePath.split('/').map((segment) => {
      const decoded = decodeURIComponent(segment);

      if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
        throw new Error('invalid encoded separator');
      }
      return decoded;
    }).join('/');
  } catch {
    throw new Error('EPUB 包含无效的内容 URL');
  }

  const decodedPath = normalizePathSegments(
    `${baseDirectory}${decodedReference}`,
    true,
  );
  return [...new Set([decodedPath, rawPath])];
};

type EpubArchiveEntry = {
  compressedSize: number;
  originalSize: number;
};

type EpubArchive = Map<string, EpubArchiveEntry>;

const inspectEpubArchive = (bytes: Uint8Array): EpubArchive => {
  const archive: EpubArchive = new Map();

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('文件不是有效的 EPUB 压缩包');
  }

  try {
    unzipSync(bytes, {
      filter: (entry) => {
        if (
          !Number.isSafeInteger(entry.size)
          || entry.size < 0
          || !Number.isSafeInteger(entry.originalSize)
          || entry.originalSize < 0
        ) {
          throw new Error('EPUB 包含无效的文件大小');
        }

        const path = zipEntryPath(entry.name);
        if (archive.has(path)) {
          throw new Error('EPUB 包含重复的文件路径');
        }
        archive.set(path, {
          compressedSize: entry.size,
          originalSize: entry.originalSize,
        });
        if (archive.size > MAX_EPUB_ENTRY_COUNT) {
          throw new Error('EPUB 包含过多文件条目');
        }
        return false;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('EPUB')) {
      throw error;
    }
    throw new Error('EPUB 压缩包目录已损坏');
  }
  return archive;
};

const resolveContentEntry = (
  archive: EpubArchive,
  basePath: string,
  reference: string,
) => {
  const candidates = contentReferencePaths(basePath, reference);
  const matches = candidates.filter((path) => archive.has(path));

  if (matches.length > 1) {
    throw new Error('EPUB 内容 URL 同时指向编码前后的不同文件');
  }
  return matches[0] ?? candidates[0];
};

const resolveOptionalContentEntry = (
  archive: EpubArchive,
  basePath: string,
  reference: string,
) => {
  const referencePath = reference.split(/[?#]/, 1)[0];

  if (
    !referencePath
    || referencePath.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/i.test(referencePath)
  ) {
    return undefined;
  }

  try {
    const path = resolveContentEntry(archive, basePath, reference);

    return archive.has(path) ? path : undefined;
  } catch {
    return undefined;
  }
};

const extractEpubEntries = async (
  bytes: Uint8Array,
  archive: EpubArchive,
  requestedPaths: Set<string>,
) => {
  let totalSize = 0;

  requestedPaths.forEach((path) => {
    const entry = archive.get(path);

    if (!entry) {
      throw new Error(`EPUB 缺少文件：${path}`);
    }
    if (entry.originalSize > MAX_EXTRACTED_ENTRY_SIZE) {
      throw new Error(`EPUB 文件过大：${path}`);
    }
    if (
      entry.originalSize > 0
      && (
        entry.compressedSize === 0
        || entry.originalSize / entry.compressedSize > MAX_COMPRESSION_RATIO
      )
    ) {
      throw new Error(`EPUB 文件压缩比异常：${path}`);
    }
    totalSize += entry.originalSize;
  });
  if (totalSize > MAX_EXTRACTED_TOTAL_SIZE) {
    throw new Error('EPUB 需要解压的内容过大');
  }

  const extracted = await new Promise<Unzipped>((resolve, reject) => {
    try {
      unzip(
        bytes,
        { filter: (entry) => requestedPaths.has(zipEntryPath(entry.name)) },
        (error, result) => {
          if (error) {
            reject(new Error('EPUB 正文已损坏或使用了不支持的压缩方式'));
          } else {
            resolve(result);
          }
        },
      );
    } catch (error) {
      reject(
        error instanceof Error && error.message.startsWith('EPUB')
          ? error
          : new Error('EPUB 正文已损坏或使用了不支持的压缩方式'),
      );
    }
  });

  const entries = new Map<string, Uint8Array>();
  let extractedSize = 0;

  Object.entries(extracted).forEach(([path, data]) => {
    const normalizedPath = zipEntryPath(path);
    const declaredSize = archive.get(normalizedPath)?.originalSize;

    if (declaredSize !== data.byteLength) {
      throw new Error(`EPUB 文件大小与目录不一致：${normalizedPath}`);
    }
    extractedSize += data.byteLength;
    if (extractedSize > MAX_EXTRACTED_TOTAL_SIZE) {
      throw new Error('EPUB 解压后的内容过大');
    }
    entries.set(normalizedPath, data);
  });
  requestedPaths.forEach((path) => {
    if (!entries.has(path)) {
      throw new Error(`EPUB 无法解压文件：${path}`);
    }
  });
  return entries;
};

const localNameElements = (document: Document | Element, name: string) => (
  Array.from(document.getElementsByTagNameNS('*', name))
);

const metadataText = (document: Document, name: string) => cleanMetadata(
  localNameElements(document, name)[0]?.textContent,
);

const canvasCoverDataUrl = (canvas: HTMLCanvasElement) => (
  canvas.toDataURL('image/jpeg', 0.86)
);

const fitCoverCanvas = (width: number, height: number) => {
  const scale = Math.min(
    1,
    COVER_MAX_WIDTH / Math.max(width, 1),
    COVER_MAX_HEIGHT / Math.max(height, 1),
  );
  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
};

const imageBytesToCover = async (bytes: Uint8Array, mediaType: string) => {
  const copy = Uint8Array.from(bytes);
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => (
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('封面图片无法读取'))
    );
    reader.onerror = () => reject(new Error('封面图片无法读取'));
    reader.readAsDataURL(new Blob([copy.buffer], { type: mediaType }));
  });
  const image = new Image();

  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('封面图片无法解码'));
    image.src = source;
  });
  if (!image.naturalWidth || !image.naturalHeight) {
    return undefined;
  }

  const canvas = fitCoverCanvas(image.naturalWidth, image.naturalHeight);
  const context = canvas.getContext('2d', { alpha: false });

  if (!context) {
    return undefined;
  }
  context.fillStyle = '#f7f4eb';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasCoverDataUrl(canvas);
};

type EpubManifestItem = {
  id: string;
  path: string;
  mediaType: string;
  properties: string;
  fallbackId?: string;
};

const readableSpineMediaTypes = new Set([
  'application/xhtml+xml',
  'text/html',
]);
const readableNavigationMediaTypes = new Set([
  ...readableSpineMediaTypes,
  'application/x-dtbncx+xml',
]);
const epubImageMediaTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
]);

const isEpubImage = (item: EpubManifestItem | undefined) => (
  Boolean(item && epubImageMediaTypes.has(item.mediaType))
);

const findEpubCoverCandidate = (
  packageDocument: Document,
  packagePath: string,
  manifest: Map<string, EpubManifestItem>,
  archive: EpubArchive,
) => {
  const propertyCover = [...manifest.values()].find((item) => (
    item.properties.split(/\s+/).includes('cover-image')
    && archive.has(item.path)
  ));
  if (propertyCover) {
    return propertyCover;
  }

  const metadataCoverId = localNameElements(packageDocument, 'meta').find((item) => (
    item.getAttribute('name')?.toLowerCase() === 'cover'
  ))?.getAttribute('content');
  const metadataCover = metadataCoverId ? manifest.get(metadataCoverId) : undefined;
  if (metadataCover && archive.has(metadataCover.path)) {
    return metadataCover;
  }

  const guideReference = localNameElements(packageDocument, 'reference').find((item) => (
    item.getAttribute('type')?.toLowerCase().split(/\s+/).includes('cover')
  ))?.getAttribute('href');
  if (guideReference) {
    const guidePath = resolveOptionalContentEntry(
      archive,
      packagePath,
      guideReference,
    );
    const guideItem = [...manifest.values()].find((item) => item.path === guidePath);

    if (guideItem) {
      return guideItem;
    }
  }

  return [...manifest.values()].find((item) => (
    isEpubImage(item)
    && archive.has(item.path)
    && /(?:^|[/_.-])cover(?:[/_.-]|$)/i.test(`${item.id}/${item.path}`)
  ));
};

const findEpubCoverImage = (
  candidate: EpubManifestItem | undefined,
  entries: Map<string, Uint8Array>,
  manifest: Map<string, EpubManifestItem>,
  archive: EpubArchive,
) => {
  if (!candidate || isEpubImage(candidate)) {
    return candidate;
  }
  if (!readableSpineMediaTypes.has(candidate.mediaType)) {
    return undefined;
  }

  const bytes = entries.get(candidate.path);
  if (!bytes) {
    return undefined;
  }
  const source = decodeMarkup(bytes);
  const document = new DOMParser().parseFromString(source, 'text/html');
  const image = localNameElements(document, 'img')[0]
    ?? localNameElements(document, 'image')[0];
  const reference = image?.getAttribute('src')
    ?? image?.getAttribute('href')
    ?? image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

  if (!reference) {
    return undefined;
  }

  try {
    const path = resolveContentEntry(archive, candidate.path, reference);

    return [...manifest.values()].find((item) => (
      item.path === path && archive.has(path) && isEpubImage(item)
    ));
  } catch {
    return undefined;
  }
};

const readEpubCover = async (
  bytes: Uint8Array,
  archive: EpubArchive,
  entries: Map<string, Uint8Array>,
  manifest: Map<string, EpubManifestItem>,
  candidate: EpubManifestItem | undefined,
  encrypted: Set<string>,
) => {
  if (!candidate || encrypted.has(candidate.path)) {
    return undefined;
  }
  try {
    const candidateEntries = entries.has(candidate.path)
      ? entries
      : new Map([
          ...entries,
          ...await extractEpubEntries(bytes, archive, new Set([candidate.path])),
        ]);
    const image = findEpubCoverImage(candidate, candidateEntries, manifest, archive);

    if (!image || encrypted.has(image.path)) {
      return undefined;
    }
    const imageBytes = candidateEntries.get(image.path)
      ?? (await extractEpubEntries(bytes, archive, new Set([image.path]))).get(image.path);

    return imageBytes
      ? await imageBytesToCover(imageBytes, image.mediaType)
      : undefined;
  } catch {
    return undefined;
  }
};

const contentsLabelPattern = /^(?:目\s*录(?:页)?|目\s*次|contents|table\s+of\s+contents)$/iu;

const looksLikeEpubContentsDocument = (source: string, item: EpubManifestItem) => {
  let document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  if (document.getElementsByTagName('parsererror').length) {
    document = new DOMParser().parseFromString(source, 'text/html');
  }

  const body = localNameElements(document, 'body')[0] ?? document.documentElement;
  const anchors = localNameElements(body, 'a').filter((anchor) => (
    Boolean(anchor.getAttribute('href') && cleanMetadata(anchor.textContent))
  ));
  const semanticToc = localNameElements(body, 'nav').some((navigation) => {
    const type = navigation.getAttribute('epub:type')
      ?? navigation.getAttribute('type')
      ?? '';

    return type.toLowerCase().split(/\s+/).includes('toc');
  });
  const labels = [
    localNameElements(document, 'title')[0]?.textContent,
    ...['h1', 'h2', 'h3'].flatMap((tag) => (
      localNameElements(body, tag).slice(0, 2).map((heading) => heading.textContent)
    )),
    ...['p', 'li'].flatMap((tag) => (
      localNameElements(body, tag).slice(0, 4).map((block) => block.textContent)
    )),
  ].map(cleanMetadata).filter(Boolean);
  const textBlocks = ['h1', 'h2', 'h3', 'p', 'li'].flatMap((tag) => (
    localNameElements(body, tag).map((block) => cleanMetadata(block.textContent))
  )).filter(Boolean);
  const labelledAsContents = labels.some((label) => contentsLabelPattern.test(label));
  const pathSuggestsContents = /(?:^|[/_.-])(?:toc|contents|nav)(?:[/_.-]|$)/i
    .test(`${item.id}/${item.path}`);
  const bodyLength = cleanMetadata(body.textContent).length;
  const linkedLength = anchors.reduce(
    (length, anchor) => length + cleanMetadata(anchor.textContent).length,
    0,
  );

  return semanticToc
    || (labelledAsContents && (anchors.length >= 2 || textBlocks.length >= 6))
    || (
      pathSuggestsContents
      && anchors.length >= 4
      && linkedLength >= Math.max(24, bodyLength * 0.34)
    );
};

const looksLikeEpubAdvertisementDocument = (
  source: string,
  item: EpubManifestItem,
) => {
  if (!/(?:^|[/_.-])ad[_-]?chapter\d*(?:[/_.-]|$)/iu.test(`${item.id}/${item.path}`)) {
    return false;
  }

  const document = new DOMParser().parseFromString(source, 'text/html');
  const body = localNameElements(document, 'body')[0] ?? document.documentElement;

  return /(?:公众号|电子书搜索下载|https?:\/\/|www\.)/iu.test(
    cleanMetadata(body.textContent),
  );
};

const resolveManifestItem = (
  manifest: Map<string, EpubManifestItem>,
  archive: EpubArchive,
  id: string,
  mediaTypes: Set<string>,
  usage: string,
) => {
  const visited = new Set<string>();
  let currentId: string | undefined = id;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`EPUB ${usage}的 fallback 形成循环`);
    }
    visited.add(currentId);

    const item = manifest.get(currentId);
    if (!item) {
      throw new Error(`EPUB ${usage}引用了不存在的 manifest 项：${currentId}`);
    }
    if (mediaTypes.has(item.mediaType) && archive.has(item.path)) {
      return item;
    }
    if (!item.fallbackId) {
      if (mediaTypes.has(item.mediaType)) {
        throw new Error(`EPUB ${usage}缺少文件：${item.path}`);
      }
      throw new Error(`EPUB ${usage}使用了不支持的格式：${item.mediaType}`);
    }
    currentId = item.fallbackId;
  }

  throw new Error(`EPUB ${usage}没有可读取的 fallback`);
};

const readEpubNavigation = (
  entries: Map<string, Uint8Array>,
  navigationItems: EpubManifestItem[],
  archive: EpubArchive,
) => {
  const titles = new Map<string, string>();

  navigationItems.forEach((navigation) => {
    const bytes = entries.get(navigation.path);
    if (!bytes) {
      throw new Error(`EPUB 无法读取目录文件：${navigation.path}`);
    }

    const source = decodeMarkup(bytes);
    const isNcx = navigation.mediaType === 'application/x-dtbncx+xml';
    const document = isNcx
      ? parseXml(source, 'EPUB NCX 目录')
      : new DOMParser().parseFromString(source, 'text/html');

    const anchors = isNcx
      ? []
      : localNameElements(document, 'nav')
        .filter((navigationElement) => {
          const type = navigationElement.getAttribute('epub:type')
            ?? navigationElement.getAttributeNS(
              'http://www.idpf.org/2007/ops',
              'type',
            )
            ?? '';

          return type.toLowerCase().split(/\s+/).includes('toc');
        })
        .flatMap((navigationElement) => localNameElements(navigationElement, 'a'));

    anchors.forEach((anchor) => {
      const href = anchor.getAttribute('href');
      const title = cleanMetadata(anchor.textContent);
      const path = href
        ? resolveOptionalContentEntry(archive, navigation.path, href)
        : undefined;

      if (path && title && !titles.has(path)) {
        titles.set(path, title);
      }
    });
    localNameElements(document, 'navPoint').forEach((point) => {
      const href = localNameElements(point, 'content')[0]?.getAttribute('src');
      const title = cleanMetadata(localNameElements(point, 'navLabel')[0]?.textContent);
      const path = href
        ? resolveOptionalContentEntry(archive, navigation.path, href)
        : undefined;

      if (path && title && !titles.has(path)) {
        titles.set(path, title);
      }
    });
  });
  return titles;
};

const readEncryptedEntries = (
  source: string,
  archive: EpubArchive,
) => {
  const document = parseXml(source, 'EPUB 加密清单');
  const encrypted = new Set<string>();

  localNameElements(document, 'CipherReference').forEach((reference) => {
    const uri = reference.getAttribute('URI');

    if (uri) {
      encrypted.add(resolveContentEntry(archive, '', uri));
    }
  });
  return encrypted;
};

const readEpub = async (
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ImportedDocumentSource> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const archive = inspectEpubArchive(bytes);
  const encryptionPath = archive.has('META-INF/encryption.xml')
    ? 'META-INF/encryption.xml'
    : undefined;
  const bootstrapPaths = new Set([
    'mimetype',
    'META-INF/container.xml',
    ...(encryptionPath ? [encryptionPath] : []),
  ]);
  const bootstrapEntries = await extractEpubEntries(bytes, archive, bootstrapPaths);

  onProgress?.(0.18);
  if (decodeText(bootstrapEntries.get('mimetype') ?? new Uint8Array()).trim()
    !== 'application/epub+zip') {
    throw new Error('文件缺少有效的 EPUB MIME 标记');
  }

  const containerBytes = bootstrapEntries.get('META-INF/container.xml');
  if (!containerBytes) {
    throw new Error('EPUB 缺少容器描述文件');
  }

  const container = parseXml(decodeMarkup(containerBytes), 'EPUB 容器描述');
  const rootfiles = localNameElements(container, 'rootfile');
  const rootfile = rootfiles.find((item) => (
    item.getAttribute('media-type') === 'application/oebps-package+xml'
  )) ?? rootfiles[0];
  const packagePathValue = rootfile?.getAttribute('full-path');
  if (!packagePathValue) {
    throw new Error('EPUB 没有可读取的书籍包');
  }

  const packagePath = resolveContentEntry(archive, '', packagePathValue);
  if (!archive.has(packagePath)) {
    throw new Error(`EPUB 书籍包指向了不存在的文件：${packagePath}`);
  }

  const encrypted = encryptionPath
    ? readEncryptedEntries(
        decodeMarkup(bootstrapEntries.get(encryptionPath) ?? new Uint8Array()),
        archive,
      )
    : new Set<string>();
  if (encrypted.has(packagePath)) {
    throw new Error('暂不支持书籍包被加密的 EPUB');
  }

  const packageEntries = await extractEpubEntries(
    bytes,
    archive,
    new Set([packagePath]),
  );
  const packageBytes = packageEntries.get(packagePath);
  if (!packageBytes) {
    throw new Error('EPUB 无法读取书籍包');
  }

  const packageDocument = parseXml(decodeMarkup(packageBytes), 'EPUB 书籍包');
  const fixedLayout = localNameElements(packageDocument, 'meta').some((meta) => {
    const property = meta.getAttribute('property')?.toLowerCase();
    const name = meta.getAttribute('name')?.toLowerCase();
    const value = cleanMetadata(
      meta.getAttribute('content') ?? meta.textContent,
    ).toLowerCase();

    return property === 'rendition:layout' && value === 'pre-paginated'
      || name === 'fixed-layout' && ['true', 'yes', 'pre-paginated'].includes(value);
  });
  if (fixedLayout) {
    throw new Error('暂不支持固定版式 EPUB');
  }
  const title = metadataText(packageDocument, 'title') || fileTitleOf(file.name);
  const author = metadataText(packageDocument, 'creator');
  const manifest = new Map<string, EpubManifestItem>();

  localNameElements(packageDocument, 'item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type');

    if (!id || !href || !mediaType) {
      throw new Error('EPUB manifest 包含不完整的资源项');
    }
    if (manifest.has(id)) {
      throw new Error(`EPUB manifest 包含重复 ID：${id}`);
    }
    manifest.set(id, {
      id,
      path: resolveContentEntry(archive, packagePath, href),
      mediaType: mediaType.toLowerCase(),
      properties: item.getAttribute('properties') ?? '',
      fallbackId: item.getAttribute('fallback') ?? undefined,
    });
  });
  const coverCandidate = findEpubCoverCandidate(
    packageDocument,
    packagePath,
    manifest,
    archive,
  );

  const spineElement = localNameElements(packageDocument, 'spine')[0];
  if (!spineElement) {
    throw new Error('EPUB 缺少正文阅读顺序');
  }

  const spine = localNameElements(spineElement, 'itemref').flatMap((item, index) => {
    if (item.getAttribute('linear')?.toLowerCase() === 'no') {
      return [];
    }
    if (
      (item.getAttribute('properties') ?? '')
        .toLowerCase()
        .split(/\s+/)
        .includes('rendition:layout-pre-paginated')
    ) {
      throw new Error('暂不支持包含固定版式页面的 EPUB');
    }
    const id = item.getAttribute('idref');

    if (!id) {
      throw new Error(`EPUB 第 ${index + 1} 个 spine 项缺少 idref`);
    }
    return [resolveManifestItem(
      manifest,
      archive,
      id,
      readableSpineMediaTypes,
      `第 ${index + 1} 个正文项`,
    )];
  });

  if (!spine.length) {
    throw new Error('EPUB 没有可读取的正文顺序');
  }

  const navigationIds = new Set(
    [...manifest.values()]
      .filter((item) => item.properties.split(/\s+/).includes('nav'))
      .map((item) => item.id),
  );
  const ncxId = spineElement.getAttribute('toc');
  if (ncxId) {
    navigationIds.add(ncxId);
  }
  const navigationItems = [...navigationIds].map((id) => resolveManifestItem(
    manifest,
    archive,
    id,
    readableNavigationMediaTypes,
    '目录',
  ));
  const protectedPaths = new Set([
    packagePath,
    ...spine.map((item) => item.path),
    ...navigationItems.map((item) => item.path),
  ]);
  const encryptedProtectedPath = [...protectedPaths].find((path) => encrypted.has(path));
  if (encryptedProtectedPath) {
    throw new Error(`暂不支持正文或目录被加密的 EPUB：${encryptedProtectedPath}`);
  }

  const requiredPaths = new Set([
    ...bootstrapPaths,
    packagePath,
    ...spine.map((item) => item.path),
    ...navigationItems.map((item) => item.path),
  ]);
  const entries = await extractEpubEntries(bytes, archive, requiredPaths);
  const navigationTitles = readEpubNavigation(
    entries,
    navigationItems,
    archive,
  );
  const cover = await readEpubCover(
    bytes,
    archive,
    entries,
    manifest,
    coverCandidate,
    encrypted,
  );
  const sections: string[] = [`# ${escapeEpubMarkdownText(title)}`];

  for (const [index, item] of spine.entries()) {
    const chapterBytes = entries.get(item.path);

    if (!chapterBytes) {
      throw new Error(`EPUB 第 ${index + 1} 章缺少正文文件：${item.path}`);
    }

    const chapterSource = decodeMarkup(chapterBytes);
    if (
      navigationIds.has(item.id)
      || looksLikeEpubContentsDocument(chapterSource, item)
      || looksLikeEpubAdvertisementDocument(chapterSource, item)
    ) {
      onProgress?.(0.2 + (index + 1) / spine.length * 0.75);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      continue;
    }

    const markdown = reflowEpubChapter(
      chapterSource,
      navigationTitles.get(item.path),
    );
    if (!markdown) {
      onProgress?.(0.2 + (index + 1) / spine.length * 0.75);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      continue;
    }

    sections.push(markdown);
    onProgress?.(0.2 + (index + 1) / spine.length * 0.75);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  const source = sections.join('\n\n');
  if (sections.length === 1) {
    throw new Error('EPUB 中没有可阅读的正文');
  }

  onProgress?.(1);
  return {
    source,
    title,
    author: author || undefined,
    ...(cover ? { cover } : {}),
  };
};

export const readDocumentFile = async (
  file: File,
  options: ReadDocumentOptions = {},
): Promise<ImportedDocumentSource> => {
  const extension = extensionOf(file.name);

  if (extension !== 'epub') {
    throw new Error('目前仅支持 EPUB');
  }
  if (file.size > MAX_EPUB_FILE_SIZE) {
    throw new Error('EPUB 文件不能超过 128 MB');
  }
  options.onProgress?.(0);
  return readEpub(file, options.onProgress);
};
