import { unzipSync, type Unzipped } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// Vite 将查询导入打包成本地 worker；ESLint 的 Node 解析器不识别该查询后缀。
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type ImportedDocumentSource = {
  source: string;
  markdown: boolean;
  title?: string;
  author?: string;
  cover?: string;
  pdf?: {
    file: Blob;
    fingerprint: string;
    pageCount: number;
    pageNumbers: number[];
    outline: Array<{
      title: string;
      level: 1 | 2 | 3;
      pageNumber: number;
    }>;
  };
};

export type ReadDocumentOptions = {
  onProgress?: (progress: number) => void;
};

const COVER_MAX_WIDTH = 720;
const COVER_MAX_HEIGHT = 1_024;
const supportedExtensions = new Set(['txt', 'md', 'markdown', 'pdf', 'epub']);
const cjkBoundaryPattern = /[\u2e80-\u9fff\uf900-\ufaff]/u;

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

const fileTitleOf = (name: string) => name
  .replace(/\.(?:txt|md|markdown|pdf|epub)$/i, '')
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
  const encoding = declaredMarkupEncoding(bytes);

  if (encoding) {
    return decodeText(bytes, encoding);
  }
  return decodeText(bytes);
};

const joinTextLines = (left: string, right: string) => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const leftCharacter = left.at(-1) ?? '';
  const rightCharacter = right[0] ?? '';
  const separator = cjkBoundaryPattern.test(leftCharacter)
    || cjkBoundaryPattern.test(rightCharacter)
    || /\s/.test(leftCharacter)
    || /^[,.;:!?，。；：！？、）》】]/u.test(rightCharacter)
    ? ''
    : ' ';

  return `${left}${separator}${right}`;
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

type EpubArchive = Set<string>;

const inspectEpubArchive = (bytes: Uint8Array): EpubArchive => {
  const archive: EpubArchive = new Set();

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('文件不是有效的 EPUB 压缩包');
  }

  try {
    unzipSync(bytes, {
      filter: (entry) => {
        if (
          !Number.isSafeInteger(entry.originalSize)
          || entry.originalSize < 0
        ) {
          throw new Error('EPUB 包含无效的文件大小');
        }

        const path = zipEntryPath(entry.name);
        if (archive.has(path)) {
          throw new Error('EPUB 包含重复的文件路径');
        }
        archive.add(path);
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

const extractEpubEntries = (
  bytes: Uint8Array,
  archive: EpubArchive,
  requestedPaths: Set<string>,
) => {
  requestedPaths.forEach((path) => {
    if (!archive.has(path)) {
      throw new Error(`EPUB 缺少文件：${path}`);
    }
  });

  let extracted: Unzipped;

  try {
    extracted = unzipSync(bytes, {
      filter: (entry) => requestedPaths.has(zipEntryPath(entry.name)),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('EPUB')) {
      throw error;
    }
    throw new Error('EPUB 正文已损坏或使用了不支持的压缩方式');
  }

  const entries = new Map<string, Uint8Array>();
  Object.entries(extracted).forEach(([path, data]) => {
    entries.set(zipEntryPath(path), data);
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

const wrapMarkdownInline = (value: string, marker: string) => {
  const leading = value.match(/^\s*/u)?.[0] ?? '';
  const trailing = value.match(/\s*$/u)?.[0] ?? '';
  const content = value.slice(leading.length, value.length - trailing.length);

  return content ? `${leading}${marker}${content}${marker}${trailing}` : value;
};

const markdownCodeSpan = (value: string) => {
  const longestFence = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = '`'.repeat(longestFence + 1);
  const padding = /^\s|\s$/u.test(value) ? ' ' : '';

  return `${fence}${padding}${value}${padding}${fence}`;
};

const markdownInlineText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent ?? '');
  }
  if (!(node instanceof Element)) {
    return '';
  }

  const tag = node.localName.toLowerCase();
  if (new Set([
    'script',
    'style',
    'svg',
    'math',
    'audio',
    'video',
    'form',
    'rt',
    'rp',
  ]).has(tag)) {
    return '';
  }
  if (tag === 'br') {
    return '\n';
  }
  if (tag === 'img') {
    return escapeMarkdownText(node.getAttribute('alt') ?? '');
  }
  if (tag === 'code' && node.parentElement?.localName.toLowerCase() !== 'pre') {
    return markdownCodeSpan(node.textContent ?? '');
  }

  const value = Array.from(node.childNodes).map(markdownInlineText).join('');

  if (tag === 'strong' || tag === 'b') {
    return wrapMarkdownInline(value, '**');
  }
  if (tag === 'em' || tag === 'i') {
    return wrapMarkdownInline(value, '*');
  }
  if (tag === 'del' || tag === 's' || tag === 'strike') {
    return wrapMarkdownInline(value, '~~');
  }
  return value;
};

const normalizeBlockText = (value: string) => value
  .replace(/[\t\f\v ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .trim();

const escapeMarkdownText = (value: string) => Array.from(value, (character) => {
  const code = character.charCodeAt(0);
  const punctuation = (code >= 0x21 && code <= 0x2f)
    || (code >= 0x3a && code <= 0x40)
    || (code >= 0x5b && code <= 0x60)
    || (code >= 0x7b && code <= 0x7e);

  return punctuation ? `\\${character}` : character;
}).join('');

const markdownTable = (table: Element) => {
  const rows = localNameElements(table, 'tr').map((row) => (
    Array.from(row.children)
      .filter((cell) => ['th', 'td'].includes(cell.localName.toLowerCase()))
      .map((cell) => normalizeBlockText(markdownInlineText(cell)))
  )).filter((row) => row.length);

  if (!rows.length) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row: string[]) => {
    const cells = [...row];

    while (cells.length < columnCount) {
      cells.push('');
    }
    return `| ${cells.slice(0, columnCount).join(' | ')} |`;
  };

  return [
    normalizeRow(rows[0]),
    normalizeRow(Array.from({ length: columnCount }, () => '---')),
    ...rows.slice(1).map(normalizeRow),
  ].join('\n');
};

const markdownList = (list: Element, depth = 0): string[] => {
  const ordered = list.localName.toLowerCase() === 'ol';
  const start = Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1;
  const lines: string[] = [];
  const items = Array.from(list.children).filter(
    (child) => child.localName.toLowerCase() === 'li',
  );

  items.forEach((item, index) => {
    const text = normalizeBlockText(
      Array.from(item.childNodes)
        .filter((child) => !(
          child instanceof Element
          && ['ul', 'ol'].includes(child.localName.toLowerCase())
        ))
        .map(markdownInlineText)
        .join(' '),
    ).replace(/\n+/g, ' ');
    const explicitValue = Number.parseInt(item.getAttribute('value') ?? '', 10);
    const ordinal = Number.isFinite(explicitValue) ? explicitValue : start + index;
    const marker = ordered ? `${ordinal}.` : '-';

    if (text) {
      lines.push(
        `${'    '.repeat(Math.min(depth, 3))}${marker} ${text}`,
      );
    }
    Array.from(item.children)
      .filter((child) => ['ul', 'ol'].includes(child.localName.toLowerCase()))
      .forEach((child) => lines.push(...markdownList(child, depth + 1)));
  });
  return lines;
};

const htmlToMarkdown = (source: string) => {
  if (/<!ENTITY\b/i.test(source)) {
    throw new Error('EPUB 正文包含不支持的实体声明');
  }

  let document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  if (document.getElementsByTagName('parsererror').length) {
    document = new DOMParser().parseFromString(source, 'text/html');
  }

  const body = localNameElements(document, 'body')[0] ?? document.documentElement;
  const blocks: string[] = [];
  const collect = (container: Element) => {
    Array.from(container.childNodes).forEach((node) => {
      if (!(node instanceof Element)) {
        const text = normalizeBlockText(node.textContent ?? '');

        if (text) {
          blocks.push(escapeMarkdownText(text));
        }
        return;
      }

      const element = node;
      const tag = element.localName.toLowerCase();

      if (new Set([
        'script',
        'style',
        'svg',
        'math',
        'audio',
        'video',
        'form',
        'nav',
      ]).has(tag)) {
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        const text = normalizeBlockText(markdownInlineText(element));

        if (text) {
          blocks.push(
            `${'#'.repeat(Number(tag[1]))} ${text}`,
          );
        }
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        const lines = markdownList(element);

        if (lines.length) {
          blocks.push(lines.join('\n'));
        }
        return;
      }
      if (tag === 'table') {
        const table = markdownTable(element);

        if (table) {
          blocks.push(table);
        }
        return;
      }
      if (tag === 'blockquote') {
        const text = normalizeBlockText(markdownInlineText(element));

        if (text) {
          blocks.push(
            text.split('\n')
              .map((line) => `> ${line}`)
              .join('\n'),
          );
        }
        return;
      }
      if (tag === 'pre') {
        const text = (element.textContent ?? '').replace(/^\n|\n$/g, '');
        const longestFence = Math.max(
          2,
          ...Array.from(text.matchAll(/~+/g), (match) => match[0].length),
        );
        const fence = '~'.repeat(longestFence + 1);
        const language = element.querySelector('code')?.className
          .match(/(?:^|\s)language-([\w+-]+)/)?.[1] ?? '';

        blocks.push(`${fence}${language}\n${text}\n${fence}`);
        return;
      }
      if (tag === 'hr') {
        blocks.push('---');
        return;
      }
      if (['p', 'figcaption', 'caption', 'dt', 'dd'].includes(tag)) {
        const text = normalizeBlockText(markdownInlineText(element));

        if (text) {
          blocks.push(text);
        }
        return;
      }

      const hasBlockChildren = Array.from(element.children).some((child) => (
        /^(?:h[1-6]|p|div|section|article|main|header|footer|aside|ul|ol|table|blockquote|pre|hr|figure)$/
          .test(child.localName.toLowerCase())
      ));

      if (hasBlockChildren) {
        collect(element);
      } else {
        const text = normalizeBlockText(markdownInlineText(element));

        if (text) {
          blocks.push(text);
        }
      }
    });
  };

  collect(body);
  return blocks.join('\n\n');
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
  ));
  if (propertyCover) {
    return propertyCover;
  }

  const metadataCoverId = localNameElements(packageDocument, 'meta').find((item) => (
    item.getAttribute('name')?.toLowerCase() === 'cover'
  ))?.getAttribute('content');
  if (metadataCoverId && manifest.has(metadataCoverId)) {
    return manifest.get(metadataCoverId);
  }

  const guideReference = localNameElements(packageDocument, 'reference').find((item) => (
    item.getAttribute('type')?.toLowerCase().split(/\s+/).includes('cover')
  ))?.getAttribute('href');
  if (guideReference) {
    const guidePath = resolveContentEntry(archive, packagePath, guideReference);
    const guideItem = [...manifest.values()].find((item) => item.path === guidePath);

    if (guideItem) {
      return guideItem;
    }
  }

  return [...manifest.values()].find((item) => (
    isEpubImage(item)
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
      item.path === path && isEpubImage(item)
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
  const image = findEpubCoverImage(candidate, entries, manifest, archive);

  if (!image || encrypted.has(image.path)) {
    return undefined;
  }
  const imageBytes = entries.get(image.path)
    ?? extractEpubEntries(bytes, archive, new Set([image.path])).get(image.path);

  if (!imageBytes) {
    return undefined;
  }
  return imageBytesToCover(imageBytes, image.mediaType).catch((): undefined => undefined);
};

const contentsLabelPattern = /^(?:目录|目次|目录页|contents|table\s+of\s+contents)$/iu;

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
  ].map(cleanMetadata).filter(Boolean);
  const labelledAsContents = labels.some((label) => contentsLabelPattern.test(label));
  const pathSuggestsContents = /(?:^|[/_.-])(?:toc|contents|nav)(?:[/_.-]|$)/i
    .test(`${item.id}/${item.path}`);
  const bodyLength = cleanMetadata(body.textContent).length;
  const linkedLength = anchors.reduce(
    (length, anchor) => length + cleanMetadata(anchor.textContent).length,
    0,
  );

  return semanticToc
    || (labelledAsContents && anchors.length >= 2)
    || (
      pathSuggestsContents
      && anchors.length >= 4
      && linkedLength >= Math.max(24, bodyLength * 0.34)
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

    localNameElements(document, 'a').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      const title = cleanMetadata(anchor.textContent);

      if (href && title) {
        titles.set(
          resolveContentEntry(archive, navigation.path, href),
          title,
        );
      }
    });
    localNameElements(document, 'navPoint').forEach((point) => {
      const href = localNameElements(point, 'content')[0]?.getAttribute('src');
      const title = cleanMetadata(localNameElements(point, 'navLabel')[0]?.textContent);

      if (href && title) {
        titles.set(
          resolveContentEntry(archive, navigation.path, href),
          title,
        );
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
  const bootstrapEntries = extractEpubEntries(bytes, archive, bootstrapPaths);

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

  const packageEntries = extractEpubEntries(
    bytes,
    archive,
    new Set([packagePath]),
  );
  const packageBytes = packageEntries.get(packagePath);
  if (!packageBytes) {
    throw new Error('EPUB 无法读取书籍包');
  }

  const packageDocument = parseXml(decodeMarkup(packageBytes), 'EPUB 书籍包');
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

  const spine = localNameElements(spineElement, 'itemref').map((item, index) => {
    const id = item.getAttribute('idref');

    if (!id) {
      throw new Error(`EPUB 第 ${index + 1} 个 spine 项缺少 idref`);
    }
    return resolveManifestItem(
      manifest,
      archive,
      id,
      readableSpineMediaTypes,
      `第 ${index + 1} 个正文项`,
    );
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
    ...(
      coverCandidate && !encrypted.has(coverCandidate.path)
        ? [coverCandidate.path]
        : []
    ),
  ]);
  const entries = extractEpubEntries(bytes, archive, requiredPaths);
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
  const sections: string[] = [`# ${escapeMarkdownText(title)}`];

  for (const [index, item] of spine.entries()) {
    const chapterBytes = entries.get(item.path);

    if (!chapterBytes) {
      throw new Error(`EPUB 第 ${index + 1} 章缺少正文文件：${item.path}`);
    }

    const chapterSource = decodeMarkup(chapterBytes);
    if (
      navigationIds.has(item.id)
      || looksLikeEpubContentsDocument(chapterSource, item)
    ) {
      onProgress?.(0.2 + (index + 1) / spine.length * 0.75);
      continue;
    }

    const markdown = htmlToMarkdown(chapterSource);
    if (!markdown) {
      onProgress?.(0.2 + (index + 1) / spine.length * 0.75);
      continue;
    }

    const navigationTitle = navigationTitles.get(item.path);
    if (navigationTitle && !/^#{1,6}\s/m.test(markdown)) {
      sections.push(
        `## ${escapeMarkdownText(navigationTitle)}\n\n${markdown}`,
      );
    } else {
      sections.push(markdown);
    }
    onProgress?.(0.2 + (index + 1) / spine.length * 0.75);
  }

  const source = sections.join('\n\n');
  if (sections.length === 1) {
    throw new Error('EPUB 中没有可阅读的正文');
  }

  onProgress?.(1);
  return {
    source,
    markdown: true,
    title,
    author: author || undefined,
    ...(cover ? { cover } : {}),
  };
};

type PdfLine = {
  text: string;
  x: number;
  y: number;
  height: number;
  right: number;
};

type PdfTextItem = {
  str: string;
  transform: unknown[];
  width: number;
  height: number;
  hasEOL: boolean;
};

const needsPdfSpace = (left: string, right: string, gap: number, height: number) => (
  gap > Math.max(1.2, height * 0.12)
  && !cjkBoundaryPattern.test(left.at(-1) ?? '')
  && !cjkBoundaryPattern.test(right[0] ?? '')
  && !/\s$/.test(left)
  && !/^[,.;:!?，。；：！？、）》】]/u.test(right)
);

const comparablePdfText = (value: string) => cleanMetadata(value)
  .normalize('NFKC')
  .replace(/[\s:：·•.。_-]+/gu, '')
  .toLowerCase();

const pdfHeadingPattern = new RegExp(
  String.raw`^(?:第[\p{Script=Han}〇零一二三四五六七八九十百千万\d]+[章节回部卷篇]`
    + String.raw`|(?:chapter|part)\s+\d+\b`
    + String.raw`|\d+(?:\.\d+){1,4}\s*\S)`,
  'iu',
);
const pdfOrderedListPattern = /^(\d{1,6})[.)、]\s*(.+)$/u;
const pdfBulletListPattern = /^(?:[-+*]\s+|•\s*)(.+)$/u;
const pdfTerminalPattern = /[。！？!?；;…][”’"'）》】〕」』]*$/u;

type PdfPageText = {
  markdown: string;
  lines: string[];
};

const pdfPageText = async (
  document: PDFDocumentProxy,
  pageNumber: number,
  outlineTitles: readonly string[],
): Promise<PdfPageText> => {
  const page = await document.getPage(pageNumber);

  try {
    const content = await page.getTextContent();
    const lines: PdfLine[] = [];
    let current: PdfLine | undefined;

    content.items.forEach((item) => {
      if (!('str' in item)) {
        return;
      }

      const textItem = item as PdfTextItem;
      const text = textItem.str.replace(/\s+/g, ' ').trim();
      if (!text) {
        if (textItem.hasEOL) {
          current = undefined;
        }
        return;
      }

      const x = Number(textItem.transform[4]) || 0;
      const y = Number(textItem.transform[5]) || 0;
      const height = Math.max(
        1,
        Math.abs(textItem.height) || Math.abs(Number(textItem.transform[3])) || 1,
      );
      const startsNewLine = !current
        || Math.abs(y - current.y) > Math.max(height, current.height) * 0.55
        || x < current.right - Math.max(height, current.height);

      if (startsNewLine) {
        current = { text, x, y, height, right: x + Math.abs(textItem.width) };
        lines.push(current);
      } else {
        current.text += needsPdfSpace(current.text, text, x - current.right, height)
          ? ` ${text}`
          : text;
        current.right = Math.max(current.right, x + Math.abs(textItem.width));
        current.height = Math.max(current.height, height);
      }

      if (textItem.hasEOL) {
        current = undefined;
      }
    });

    if (!lines.length) {
      return { markdown: '', lines: [] };
    }

    const originalLines = lines.map((line) => line.text);
    const heights = lines.map((line) => line.height).sort(
      (left, right) => left - right,
    );
    const medianHeight = heights[Math.floor(heights.length / 2)] ?? 1;
    const knownHeadings = new Set(outlineTitles.map(comparablePdfText));
    const contentLines = lines.filter((line, index) => {
      const atPageEdge = index < 2 || index >= lines.length - 2;

      return !(atPageEdge && /^(?:\d{1,5}|[ivxlcdm]{1,10})$/i.test(line.text));
    });
    const leftEdge = Math.min(...contentLines.map((line) => line.x));
    const blocks: string[] = [];
    let paragraph = '';

    const flushParagraph = () => {
      if (paragraph) {
        blocks.push(escapeMarkdownText(paragraph));
        paragraph = '';
      }
    };

    contentLines.forEach((line, index) => {
      const previous = contentLines[index - 1];
      const verticalGap = previous ? Math.abs(previous.y - line.y) : 0;
      const comparable = comparablePdfText(line.text);
      if (knownHeadings.has(comparable)) {
        flushParagraph();
        return;
      }

      const heading = line.text.length <= 96
        && pdfHeadingPattern.test(line.text)
        && line.height >= medianHeight * 1.04;
      if (heading) {
        flushParagraph();
        const headingLevel = Math.min(
          4,
          Math.max(2, (line.text.match(/\./g)?.length ?? 0) + 1),
        );

        blocks.push(`${'#'.repeat(headingLevel)} ${escapeMarkdownText(line.text)}`);
        return;
      }

      const orderedList = line.text.match(pdfOrderedListPattern);
      const bulletList = line.text.match(pdfBulletListPattern);
      if (orderedList || bulletList) {
        flushParagraph();
        blocks.push(orderedList
          ? `${Number(orderedList[1])}. ${escapeMarkdownText(orderedList[2])}`
          : `- ${escapeMarkdownText(bulletList?.[1] ?? '')}`);
        return;
      }

      const startsIndentedParagraph = Boolean(
        previous
        && line.x > leftEdge + medianHeight * 0.72
        && pdfTerminalPattern.test(previous.text)
      );
      const startsBlock = Boolean(
        previous
        && (
          verticalGap > Math.max(previous.height, line.height, medianHeight) * 2.25
          || startsIndentedParagraph
        )
      );

      if (startsBlock && paragraph) {
        flushParagraph();
      }
      paragraph = joinTextLines(paragraph, line.text);
    });
    flushParagraph();
    return { markdown: blocks.join('\n\n'), lines: originalLines };
  } finally {
    page.cleanup();
  }
};

const looksLikePdfContentsPage = (
  lines: readonly string[],
  continuation = false,
) => {
  const cleaned = lines.map((line) => cleanMetadata(line).normalize('NFKC')).filter(Boolean);
  const labelled = cleaned.slice(0, 8).some((line) => contentsLabelPattern.test(line));
  const entries = cleaned.filter((line) => (
    /(?:\.{2,}|…{2,}|·{2,}|\s)\s*\d{1,4}$/u.test(line)
    || /^(?:第.+[章节回部卷篇]|\d+(?:\.\d+)+|chapter\s+\d+).+\s\d{1,4}$/iu.test(line)
    || /^\d+(?:\.\d+){1,4}\s*\S+/u.test(line)
    || /^\d{1,4}[.)、]?\s+(?:第.+[章节回部卷篇]|\d+(?:\.\d+){1,4}\s*\S+)/iu.test(line)
  )).length;

  return labelled
    ? entries >= 2 || cleaned.length >= 6
    : entries >= 6 || (continuation && entries >= 5);
};

const looksLikePdfCoverPage = (
  lines: readonly string[],
  title: string,
) => {
  const cleaned = lines.map(cleanMetadata).filter(Boolean);
  const titleKey = comparablePdfText(title);
  const totalLength = cleaned.reduce((length, line) => length + line.length, 0);

  return cleaned.length <= 8
    && totalLength <= 220
    && cleaned.some((line) => comparablePdfText(line).includes(titleKey));
};

const renderPdfCover = async (pdfDocument: PDFDocumentProxy) => {
  const page = await pdfDocument.getPage(1);

  try {
    const naturalViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      COVER_MAX_WIDTH / Math.max(naturalViewport.width, 1),
      COVER_MAX_HEIGHT / Math.max(naturalViewport.height, 1),
    );
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });

    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    if (!context) {
      return undefined;
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvasCoverDataUrl(canvas);
  } finally {
    page.cleanup();
  }
};

type PdfOutlineNode = {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineNode[];
};

const pdfOutline = async (document: PDFDocumentProxy) => {
  const headings = new Map<
    number,
    Array<{ title: string; level: 1 | 2 | 3 }>
  >();
  const outline = await document.getOutline()
    .catch((): null => null) as PdfOutlineNode[] | null;
  let count = 0;

  const visit = async (nodes: PdfOutlineNode[], level: number): Promise<void> => {
    for (const node of nodes) {
      if (count >= 500) {
        return;
      }
      count += 1;

      const destination = typeof node.dest === 'string'
        ? await document.getDestination(node.dest).catch((): null => null)
        : node.dest;
      const reference = destination?.[0];
      let pageIndex: number | undefined;

      if (typeof reference === 'number') {
        pageIndex = reference;
      } else if (
        reference
        && typeof reference === 'object'
        && 'num' in reference
        && 'gen' in reference
      ) {
        pageIndex = await document.getPageIndex(
          reference as { num: number; gen: number },
        ).catch((): undefined => undefined);
      }

      const title = cleanMetadata(node.title);
      if (pageIndex !== undefined && title) {
        const pageHeadings = headings.get(pageIndex) ?? [];

        pageHeadings.push({
          title,
          level: Math.min(3, Math.max(1, level)) as 1 | 2 | 3,
        });
        headings.set(pageIndex, pageHeadings);
      }
      if (node.items?.length) {
        await visit(node.items, level + 1);
      }
    }
  };

  if (outline) {
    await visit(outline, 1);
  }
  return headings;
};

const pdfOutlineContentsPages = (
  headings: ReadonlyMap<number, Array<{ title: string }>>,
) => {
  const outlinedPages = [...headings.entries()].sort(
    ([leftPage], [rightPage]) => leftPage - rightPage,
  );
  const contentsIndex = outlinedPages.findIndex(([, pageHeadings]) => (
    pageHeadings.some((heading) => contentsLabelPattern.test(heading.title))
  ));

  if (contentsIndex < 0) {
    return new Set<number>();
  }
  const startPageNumber = outlinedPages[contentsIndex][0] + 1;
  const nextContentPage = outlinedPages.slice(contentsIndex + 1).find(
    ([, pageHeadings]) => pageHeadings.some(
      (heading) => !contentsLabelPattern.test(heading.title),
    ),
  );
  const endPageNumber = nextContentPage?.[0] !== undefined
    ? nextContentPage[0] + 1
    : startPageNumber + 1;

  return new Set(Array.from(
    { length: Math.max(0, endPageNumber - startPageNumber) },
    (_, index) => startPageNumber + index,
  ));
};

const readPdf = async (
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ImportedDocumentSource> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder('windows-1252').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('文件不是有效的 PDF');
  }

  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist');

  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = getDocument({
    data: bytes,
    useWasm: false,
  });
  let document: PDFDocumentProxy | undefined;

  try {
    document = await loadingTask.promise;
    onProgress?.(0.08);
    const metadata = await document.getMetadata().catch((): null => null);
    const info = metadata?.info as Record<string, unknown> | undefined;
    const xmpTitle = metadata?.metadata?.get('dc:title');
    const xmpAuthor = metadata?.metadata?.get('dc:creator');
    const title = cleanMetadata(info?.Title)
      || cleanMetadata(xmpTitle)
      || fileTitleOf(file.name);
    const author = cleanMetadata(info?.Author) || cleanMetadata(xmpAuthor);
    const [headings, cover] = await Promise.all([
      pdfOutline(document),
      renderPdfCover(document).catch((): undefined => undefined),
    ]);
    const sections: string[] = [`# ${escapeMarkdownText(title)}`];
    let skippingContents = false;
    let meaningfulTextPages = 0;
    const skippedPageNumbers = new Set<number>();
    const outlineContentsPages = pdfOutlineContentsPages(headings);
    const contentsPageLimit = Math.min(
      120,
      Math.max(8, Math.ceil(document.numPages * 0.12)),
    );

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pageHeadings = headings.get(pageNumber - 1) ?? [];
      const pageText = await pdfPageText(
        document,
        pageNumber,
        pageHeadings.map((heading) => heading.title),
      );
      const coverPage = pageNumber === 1
        && looksLikePdfCoverPage(pageText.lines, title);
      const contentsPage: boolean = pageNumber <= contentsPageLimit
        && (
          outlineContentsPages.has(pageNumber)
          || looksLikePdfContentsPage(pageText.lines, skippingContents)
        );
      const pageTextLength = cleanMetadata(pageText.lines.join('')).length;

      if (pageTextLength >= 80) {
        meaningfulTextPages += 1;
      }

      if (coverPage || contentsPage) {
        skippedPageNumbers.add(pageNumber);
        skippingContents = contentsPage;
        onProgress?.(0.1 + pageNumber / document.numPages * 0.88);
        continue;
      }
      skippingContents = false;
      const section = [
        ...pageHeadings.map((heading) => (
          `${'#'.repeat(heading.level)} ${escapeMarkdownText(heading.title)}`
        )),
        pageText.markdown,
      ].filter(Boolean).join('\n\n');

      if (section) {
        sections.push(section);
      }
      onProgress?.(0.1 + pageNumber / document.numPages * 0.88);
    }

    const minimumTextPages = Math.max(1, Math.ceil(document.numPages * 0.25));
    if (meaningfulTextPages < minimumTextPages) {
      const allPageNumbers = Array.from(
        { length: document.numPages },
        (_, index) => index + 1,
      );
      const readablePageNumbers = allPageNumbers.filter(
        (pageNumber) => !skippedPageNumbers.has(pageNumber),
      );
      const pageNumbers = readablePageNumbers.length
        ? readablePageNumbers
        : allPageNumbers;
      const fingerprint = document.fingerprints.find(
        (value): value is string => typeof value === 'string' && Boolean(value),
      ) ?? `${file.name}:${file.size}:${file.lastModified}`;
      const outline = [...headings.entries()].flatMap(([pageIndex, pageHeadings]) => (
        pageHeadings.map((heading) => ({
          ...heading,
          pageNumber: pageIndex + 1,
        }))
      ));

      onProgress?.(1);
      return {
        source: pageNumbers.map((pageNumber) => `第 ${pageNumber} 页`).join('\n\n'),
        markdown: false,
        title,
        author: author || undefined,
        ...(cover ? { cover } : {}),
        pdf: {
          file: file.slice(0, file.size, 'application/pdf'),
          fingerprint,
          pageCount: document.numPages,
          pageNumbers,
          outline,
        },
      };
    }

    if (!sections.slice(1).some((section) => /\S/.test(section.replace(/^#{1,6} .*$/gm, '')))) {
      throw new Error('PDF 中没有可提取的文字，扫描版 PDF 暂不支持 OCR');
    }

    onProgress?.(1);
    return {
      source: sections.join('\n\n'),
      markdown: true,
      title,
      author: author || undefined,
      ...(cover ? { cover } : {}),
    };
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('PDF')
      || error.message.includes('扫描版')
    )) {
      throw error;
    }
    if (error instanceof Error && /password/i.test(`${error.name} ${error.message}`)) {
      throw new Error('暂不支持需要密码的 PDF');
    }
    throw new Error('PDF 已损坏或使用了暂不支持的格式');
  } finally {
    await loadingTask.destroy().catch((): void => undefined);
  }
};

export const readDocumentFile = async (
  file: File,
  options: ReadDocumentOptions = {},
): Promise<ImportedDocumentSource> => {
  const extension = extensionOf(file.name);

  if (!supportedExtensions.has(extension)) {
    throw new Error('目前支持 TXT、Markdown、PDF 和 EPUB');
  }
  options.onProgress?.(0);

  if (extension === 'pdf') {
    return readPdf(file, options.onProgress);
  }
  if (extension === 'epub') {
    return readEpub(file, options.onProgress);
  }

  const source = decodeText(new Uint8Array(await file.arrayBuffer()));
  options.onProgress?.(1);
  return {
    source,
    markdown: extension !== 'txt',
  };
};
