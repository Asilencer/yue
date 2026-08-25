import type {
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { readDocumentFile } from './document-import';

export type ImportedBookChapter = {
  title: string;
  level: 1 | 2 | 3;
  paragraphIndex: number;
};

export type TableAlignment = 'left' | 'center' | 'right';

export type ImportedInlineMark = 'strong' | 'emphasis' | 'delete';

export type ImportedInlineRun = {
  kind: 'text' | 'code' | 'math' | 'break';
  value: string;
  marks?: ImportedInlineMark[];
};

type ImportedInlineContent = {
  inlines?: ImportedInlineRun[];
};

export type ImportedBookFormat =
  | ({
      kind: 'rich-text';
      paragraphIndex: number;
      inlines: ImportedInlineRun[];
    })
  | ({
      kind: 'heading';
      paragraphIndex: number;
      level: 1 | 2 | 3 | 4 | 5 | 6;
    } & ImportedInlineContent)
  | ({
      kind: 'list-item';
      paragraphIndex: number;
      groupId: number;
      ordered: boolean;
      ordinal: number;
      depth: number;
      checked?: boolean;
    } & ImportedInlineContent)
  | {
      kind: 'table-row';
      paragraphIndex: number;
      groupId: number;
      header: boolean;
      cells: string[];
      cellInlines?: Array<ImportedInlineRun[] | null>;
      alignments: TableAlignment[];
    }
  | ({
      kind: 'blockquote';
      paragraphIndex: number;
    } & ImportedInlineContent)
  | {
      kind: 'code-block';
      paragraphIndex: number;
      language: string;
    }
  | {
      kind: 'math-block';
      paragraphIndex: number;
    }
  | {
      kind: 'thematic-break';
      paragraphIndex: number;
    };

export type ImportedPdfDocument = {
  file: Blob;
  fingerprint: string;
  pageCount: number;
  pageNumbers: number[];
};

export type ImportedBookRecord = {
  id: string;
  title: string;
  author: string;
  color: string;
  cover?: string;
  chapterTitle: string;
  paragraphs: string[];
  chapters: ImportedBookChapter[];
  formats: ImportedBookFormat[];
  pdf?: ImportedPdfDocument;
  sourceName?: string;
  sourceFormat?: ImportedSourceFormat;
  imported: true;
  createdAt: number;
};

export type ImportedBookMetadata = Omit<
  ImportedBookRecord,
  'paragraphs' | 'chapters' | 'formats' | 'pdf'
>;

export type ParseImportedBookOptions = {
  onProgress?: (progress: number) => void;
};

export type ImportedSourceFormat = 'markdown' | 'txt' | 'pdf' | 'epub';

const DATABASE_NAME = 'yuguang-library';
const DATABASE_VERSION = 2;
const METADATA_STORE_NAME = 'books';
const CONTENT_STORE_NAME = 'bookContents';
const SCHEMA_VERSION = 2;
const COVER_DATA_URL_LIMIT = 3 * 1024 * 1024;
const coverColors = ['#5276c7', '#5c7f70', '#ef8b74', '#c99a52', '#6b657f'];

const normalizeWereadCoverUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2_048) {
    return undefined;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname === 'cdn.weread.qq.com'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

const isStoredCover = (value: string) => (
  (
    value.length <= COVER_DATA_URL_LIMIT
    && /^data:image\/jpeg;base64,[a-z\d+/]+=*$/i.test(value)
  )
  || normalizeWereadCoverUrl(value) === value
);

type StoredBookMetadata = ImportedBookMetadata & {
  schemaVersion: typeof SCHEMA_VERSION;
};

type StoredBookContent = {
  id: string;
  paragraphs: string[];
  chapters: ImportedBookChapter[];
  formats: ImportedBookFormat[];
  pdf?: ImportedPdfDocument;
  schemaVersion: typeof SCHEMA_VERSION;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readBookChapters = (
  value: unknown,
  paragraphCount: number,
): ImportedBookChapter[] | null => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const chapters: ImportedBookChapter[] = [];

  for (const chapter of value) {
    if (!isRecord(chapter)) {
      return null;
    }

    const { title, level, paragraphIndex } = chapter;
    if (
      typeof title !== 'string'
      || !title.trim()
      || (level !== 1 && level !== 2 && level !== 3)
      || typeof paragraphIndex !== 'number'
      || !Number.isInteger(paragraphIndex)
      || paragraphIndex < 0
      || paragraphIndex >= paragraphCount
    ) {
      return null;
    }
    chapters.push({ title, level, paragraphIndex });
  }
  return chapters;
};

const isTableAlignment = (value: unknown): value is TableAlignment => (
  value === 'left' || value === 'center' || value === 'right'
);

const isInlineMark = (value: unknown): value is ImportedInlineMark => (
  value === 'strong' || value === 'emphasis' || value === 'delete'
);

const readInlineRuns = (
  value: unknown,
  paragraph: string,
): ImportedInlineRun[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.length) {
    return null;
  }

  const runs: ImportedInlineRun[] = [];

  for (const run of value) {
    if (!isRecord(run)) {
      return null;
    }
    const { kind, value: runValue, marks } = run;
    if (
      (kind !== 'text' && kind !== 'code' && kind !== 'math' && kind !== 'break')
      || typeof runValue !== 'string'
      || !runValue
      || (kind === 'break' && runValue !== '\n')
      || (
        marks !== undefined
        && (
          !Array.isArray(marks)
          || !marks.length
          || marks.some((mark) => !isInlineMark(mark))
          || new Set(marks).size !== marks.length
        )
      )
    ) {
      return null;
    }
    runs.push({
      kind,
      value: runValue,
      ...(Array.isArray(marks) ? { marks: [...marks] as ImportedInlineMark[] } : {}),
    });
  }
  return runs.map((run) => run.value).join('') === paragraph ? runs : null;
};

const readBookFormats = (
  value: unknown,
  paragraphs: readonly string[],
): ImportedBookFormat[] | null => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const formats: ImportedBookFormat[] = [];
  const formattedParagraphs = new Set<number>();

  for (const format of value) {
    if (!isRecord(format)) {
      return null;
    }

    const { kind, paragraphIndex } = format;
    if (
      typeof paragraphIndex !== 'number'
      || !Number.isInteger(paragraphIndex)
      || paragraphIndex < 0
      || paragraphIndex >= paragraphs.length
      || formattedParagraphs.has(paragraphIndex)
    ) {
      return null;
    }

    const inlines = readInlineRuns(format.inlines, paragraphs[paragraphIndex]);
    if (inlines === null) {
      return null;
    }

    if (kind === 'rich-text') {
      if (!inlines) {
        return null;
      }
      formats.push({ kind, paragraphIndex, inlines });
    } else if (kind === 'heading') {
      const { level } = format;
      if (
        level !== 1
        && level !== 2
        && level !== 3
        && level !== 4
        && level !== 5
        && level !== 6
      ) {
        return null;
      }
      formats.push({ kind, paragraphIndex, level, ...(inlines ? { inlines } : {}) });
    } else if (kind === 'list-item') {
      const { groupId, ordered, ordinal, depth, checked } = format;
      if (
        typeof groupId !== 'number'
        || !Number.isInteger(groupId)
        || groupId < 0
        || typeof ordered !== 'boolean'
        || typeof ordinal !== 'number'
        || !Number.isInteger(ordinal)
        || ordinal < 0
        || typeof depth !== 'number'
        || !Number.isInteger(depth)
        || depth < 0
        || depth > 6
        || (checked !== undefined && typeof checked !== 'boolean')
      ) {
        return null;
      }
      const normalizedChecked = typeof checked === 'boolean' ? checked : undefined;

      formats.push({
        kind,
        paragraphIndex,
        groupId,
        ordered,
        ordinal,
        depth,
        ...(normalizedChecked === undefined ? {} : { checked: normalizedChecked }),
        ...(inlines ? { inlines } : {}),
      });
    } else if (kind === 'table-row') {
      const {
        groupId,
        header,
        cells,
        cellInlines,
        alignments,
      } = format;
      if (
        typeof groupId !== 'number'
        || !Number.isInteger(groupId)
        || groupId < 0
        || typeof header !== 'boolean'
        || !Array.isArray(cells)
        || !cells.length
        || !cells.every((cell) => typeof cell === 'string')
        || !Array.isArray(alignments)
        || !alignments.every(isTableAlignment)
        || (
          cellInlines !== undefined
          && (!Array.isArray(cellInlines) || cellInlines.length !== cells.length)
        )
      ) {
        return null;
      }
      const normalizedCellInlines: Array<ImportedInlineRun[] | null> = [];

      if (Array.isArray(cellInlines)) {
        for (let index = 0; index < cellInlines.length; index += 1) {
          if (cellInlines[index] === null) {
            normalizedCellInlines.push(null);
            continue;
          }
          const cellRuns = readInlineRuns(cellInlines[index], cells[index]);
          if (!cellRuns) {
            return null;
          }
          normalizedCellInlines.push(cellRuns);
        }
      }
      const normalizedAlignments = cells.map((_, index) => (
        isTableAlignment(alignments[index]) ? alignments[index] : 'left'
      ));
      formats.push({
        kind,
        paragraphIndex,
        groupId,
        header,
        cells,
        ...(normalizedCellInlines.length ? { cellInlines: normalizedCellInlines } : {}),
        alignments: normalizedAlignments,
      });
    } else if (kind === 'blockquote') {
      formats.push({ kind, paragraphIndex, ...(inlines ? { inlines } : {}) });
    } else if (kind === 'code-block') {
      const { language } = format;
      if (typeof language !== 'string') {
        return null;
      }
      formats.push({ kind, paragraphIndex, language });
    } else if (kind === 'math-block') {
      formats.push({ kind, paragraphIndex });
    } else if (kind === 'thematic-break') {
      formats.push({ kind, paragraphIndex });
    } else {
      return null;
    }

    formattedParagraphs.add(paragraphIndex);
  }
  return formats;
};

const readBookMetadata = (value: unknown): ImportedBookMetadata | null => {
  if (!isRecord(value)) {
    return null;
  }

  const {
    id,
    title,
    author,
    color,
    cover,
    chapterTitle,
    sourceName,
    sourceFormat,
    imported,
    createdAt,
  } = value;
  if (
    typeof id !== 'string'
    || !id
    || typeof title !== 'string'
    || !title
    || typeof author !== 'string'
    || typeof color !== 'string'
    || (
      cover !== undefined
      && (
        typeof cover !== 'string'
        || !isStoredCover(cover)
      )
    )
    || typeof chapterTitle !== 'string'
    || (
      sourceName !== undefined
      && (typeof sourceName !== 'string' || !sourceName || sourceName.length > 512)
    )
    || (
      sourceFormat !== undefined
      && sourceFormat !== 'markdown'
      && sourceFormat !== 'txt'
      && sourceFormat !== 'pdf'
      && sourceFormat !== 'epub'
    )
    || imported !== true
    || typeof createdAt !== 'number'
    || !Number.isFinite(createdAt)
    || createdAt < 0
  ) {
    return null;
  }

  const normalizedSourceFormat = typeof sourceFormat === 'string'
    ? sourceFormat as ImportedSourceFormat
    : undefined;

  return {
    id,
    title,
    author,
    color,
    ...(typeof cover === 'string' ? { cover } : {}),
    chapterTitle,
    ...(typeof sourceName === 'string' ? { sourceName } : {}),
    ...(normalizedSourceFormat ? { sourceFormat: normalizedSourceFormat } : {}),
    imported,
    createdAt,
  };
};

const readPdfDocument = (value: unknown): ImportedPdfDocument | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }

  const {
    file,
    fingerprint,
    pageCount,
    pageNumbers,
  } = value;
  if (
    !(file instanceof Blob)
    || file.size === 0
    || (file.type && file.type !== 'application/pdf')
    || typeof fingerprint !== 'string'
    || !fingerprint
    || typeof pageCount !== 'number'
    || !Number.isInteger(pageCount)
    || pageCount < 1
    || !Array.isArray(pageNumbers)
    || !pageNumbers.length
    || pageNumbers.some((pageNumber, index) => (
      typeof pageNumber !== 'number'
      || !Number.isInteger(pageNumber)
      || pageNumber < 1
      || pageNumber > pageCount
      || (index > 0 && pageNumber <= pageNumbers[index - 1])
    ))
  ) {
    return null;
  }

  return {
    file,
    fingerprint,
    pageCount,
    pageNumbers: [...pageNumbers],
  };
};

const readImportedBook = (value: unknown): ImportedBookRecord | null => {
  const metadata = readBookMetadata(value);

  if (!metadata || !isRecord(value)) {
    return null;
  }

  const { paragraphs } = value;
  if (
    !Array.isArray(paragraphs)
    || !paragraphs.length
    || !paragraphs.every((paragraph) => typeof paragraph === 'string' && paragraph.length > 0)
  ) {
    return null;
  }

  const chapters = readBookChapters(value.chapters, paragraphs.length);
  const formats = readBookFormats(value.formats, paragraphs);
  const pdf = readPdfDocument(value.pdf);
  if (
    !chapters
    || !formats
    || pdf === null
    || (pdf && metadata.sourceFormat !== 'pdf')
  ) {
    return null;
  }

  return {
    ...metadata,
    paragraphs,
    chapters,
    formats,
    ...(pdf ? { pdf } : {}),
  };
};

const readStoredMetadata = (value: unknown): ImportedBookMetadata | null => {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) {
    return null;
  }

  return readBookMetadata(value);
};

const readStoredContent = (value: unknown): StoredBookContent | null => {
  if (
    !isRecord(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || typeof value.id !== 'string'
    || !value.id
    || !Array.isArray(value.paragraphs)
    || !value.paragraphs.length
    || !value.paragraphs.every(
      (paragraph) => typeof paragraph === 'string' && paragraph.length > 0,
    )
  ) {
    return null;
  }

  const chapters = readBookChapters(value.chapters, value.paragraphs.length);
  const formats = readBookFormats(value.formats, value.paragraphs);
  const pdf = readPdfDocument(value.pdf);
  if (!chapters || !formats || pdf === null) {
    return null;
  }

  return {
    id: value.id,
    paragraphs: value.paragraphs,
    chapters,
    formats,
    ...(pdf ? { pdf } : {}),
    schemaVersion: SCHEMA_VERSION,
  };
};

const toStoredMetadata = (book: ImportedBookRecord): StoredBookMetadata => ({
  id: book.id,
  title: book.title,
  author: book.author,
  color: book.color,
  ...(book.cover ? { cover: book.cover } : {}),
  chapterTitle: book.chapterTitle,
  ...(book.sourceName ? { sourceName: book.sourceName } : {}),
  ...(book.sourceFormat ? { sourceFormat: book.sourceFormat } : {}),
  imported: true,
  createdAt: book.createdAt,
  schemaVersion: SCHEMA_VERSION,
});

const toStoredContent = (book: ImportedBookRecord): StoredBookContent => ({
  id: book.id,
  paragraphs: book.paragraphs,
  chapters: book.chapters,
  formats: book.formats,
  ...(book.pdf ? { pdf: book.pdf } : {}),
  schemaVersion: SCHEMA_VERSION,
});

const databaseError = (message: string, cause?: DOMException | null) => (
  new Error(cause?.message ? `${message}：${cause.message}` : message)
);

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(databaseError('本地书架请求失败', request.error));
});

const transactionComplete = (transaction: IDBTransaction) => new Promise<void>(
  (resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      databaseError('本地书架事务失败', transaction.error),
    );
    transaction.onabort = () => reject(
      databaseError('本地书架事务已中止', transaction.error),
    );
  },
);

const completeTransaction = async <T>(
  transaction: IDBTransaction,
  result: Promise<T>,
) => {
  const completion = transactionComplete(transaction);

  try {
    const value = await result;

    await completion;
    return value;
  } catch (error) {
    await completion.catch((): void => undefined);
    throw error;
  }
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  let blocked = false;

  request.onblocked = () => {
    blocked = true;
    reject(new Error('本地书架正在被另一个窗口使用，请关闭其他窗口后重试'));
  };
  request.onupgradeneeded = (event) => {
    const database = request.result;
    const transaction = request.transaction;

    if (!transaction) {
      reject(new Error('无法启动本地书架升级事务'));
      return;
    }

    const metadataStore = database.objectStoreNames.contains(METADATA_STORE_NAME)
      ? transaction.objectStore(METADATA_STORE_NAME)
      : database.createObjectStore(METADATA_STORE_NAME, { keyPath: 'id' });
    const contentStore = database.objectStoreNames.contains(CONTENT_STORE_NAME)
      ? transaction.objectStore(CONTENT_STORE_NAME)
      : database.createObjectStore(CONTENT_STORE_NAME, { keyPath: 'id' });

    if (event.oldVersion !== 1) {
      return;
    }

    const cursorRequest = metadataStore.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;

      if (!cursor) {
        return;
      }

      const legacyBook = readImportedBook(cursor.value);
      if (legacyBook) {
        contentStore.put(toStoredContent(legacyBook));
        cursor.update(toStoredMetadata(legacyBook));
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => transaction.abort();
  };
  request.onsuccess = () => {
    if (blocked) {
      request.result.close();
      return;
    }
    resolve(request.result);
  };
  request.onerror = () => reject(
    databaseError('无法打开本地书架', request.error),
  );
});

const normalizePlainText = (value: string) => value.replace(/\s+/g, ' ').trim();

const unicodeLength = (value: string) => Array.from(value).length;

const truncateUnicode = (value: string, maximumLength: number) => (
  Array.from(value).slice(0, maximumLength).join('')
);

type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath);
const eastAsianCharacterPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60]/u;

const parseMarkdownAst = (source: string) => markdownParser.parse(source) as Root;

const normalizeMarkdownTextNode = (value: string) => value
  .replace(/[ \t]*\r?\n[ \t]*/g, (lineBreak, offset: number) => {
    const left = value[offset - 1] ?? '';
    const right = value[offset + lineBreak.length] ?? '';

    return eastAsianCharacterPattern.test(left)
      && eastAsianCharacterPattern.test(right)
      ? ''
      : ' ';
  })
  .replace(/[ \t]+/g, ' ');

const appendInlineRun = (
  runs: ImportedInlineRun[],
  kind: ImportedInlineRun['kind'],
  rawValue: string,
  marks: readonly ImportedInlineMark[] = [],
) => {
  const value = kind === 'text'
    ? normalizeMarkdownTextNode(rawValue)
    : kind === 'code'
      ? rawValue
      : kind === 'math'
        ? rawValue.trim()
        : '\n';

  if (!value || (kind === 'break' && runs.at(-1)?.kind === 'break')) {
    return;
  }
  const normalizedMarks = kind !== 'break' && marks.length
    ? [...new Set(marks)]
    : undefined;
  const previous = runs.at(-1);
  const sameMarks = (previous?.marks ?? []).join('\0')
    === (normalizedMarks ?? []).join('\0');

  if (kind === 'text' && previous?.kind === 'text' && sameMarks) {
    previous.value += value;
  } else {
    runs.push({ kind, value, ...(normalizedMarks ? { marks: normalizedMarks } : {}) });
  }
};

const collectInlineRuns = (
  nodes: readonly PhrasingContent[],
  runs: ImportedInlineRun[] = [],
  marks: readonly ImportedInlineMark[] = [],
) => {
  nodes.forEach((node) => {
    if (node.type === 'text') {
      appendInlineRun(runs, 'text', node.value, marks);
    } else if (node.type === 'inlineCode') {
      appendInlineRun(runs, 'code', node.value, marks);
    } else if (node.type === 'inlineMath') {
      appendInlineRun(runs, 'math', node.value, marks);
    } else if (node.type === 'break') {
      appendInlineRun(runs, 'break', '\n');
    } else if (node.type === 'image' || node.type === 'imageReference') {
      appendInlineRun(runs, 'text', node.alt ?? '', marks);
    } else if (node.type === 'footnoteReference') {
      appendInlineRun(runs, 'text', `［${node.label ?? node.identifier}］`, marks);
    } else if (node.type === 'html') {
      if (/^<br\s*\/?\s*>$/i.test(node.value.trim())) {
        appendInlineRun(runs, 'break', '\n');
      }
    } else if (
      node.type === 'strong'
      || node.type === 'emphasis'
      || node.type === 'delete'
    ) {
      const mark: ImportedInlineMark = node.type;

      collectInlineRuns(node.children, runs, [...marks, mark]);
    } else {
      const parent = node as unknown as { children?: PhrasingContent[] };
      if (parent.children) {
        collectInlineRuns(parent.children, runs, marks);
      }
    }
  });
  return runs;
};

const trimInlineRuns = (runs: ImportedInlineRun[]) => {
  while (runs[0]?.kind === 'break') {
    runs.shift();
  }
  while (runs.at(-1)?.kind === 'break') {
    runs.pop();
  }
  if (runs[0]?.kind === 'text') {
    runs[0].value = runs[0].value.trimStart();
  }
  const last = runs.at(-1);
  if (last?.kind === 'text') {
    last.value = last.value.trimEnd();
  }
  return runs.filter((run) => run.value);
};

const normalizeInlineRuns = (nodes: readonly PhrasingContent[]) => (
  trimInlineRuns(collectInlineRuns(nodes))
);

const inlineRunsText = (runs: readonly ImportedInlineRun[]) => (
  runs.map((run) => run.value).join('')
);

const findMarkdownTitle = (tree: Root) => {
  const heading = tree.children.find((node) => (
    node.type === 'heading' && node.depth === 1
  ));

  return heading?.type === 'heading'
    ? inlineRunsText(normalizeInlineRuns(heading.children)) || undefined
    : undefined;
};

const yamlFrontMatterKeys = new Set([
  'title',
  'author',
  'creator',
  'date',
  'language',
  'lang',
  'description',
  'tags',
  'doc_type',
  'cover',
]);

type MarkdownFrontMatter = {
  source: string;
  title?: string;
  author?: string;
  cover?: string;
  docType?: string;
};

const readConservativeYamlFrontMatter = (source: string): MarkdownFrontMatter => {
  const unchanged = { source };
  const lines = source.split('\n');
  if (lines[0] !== '---') {
    return unchanged;
  }

  let closingIndex = -1;
  const searchLimit = Math.min(lines.length, 65);

  for (let index = 1; index < searchLimit; index += 1) {
    if (lines[index] === '---' || lines[index] === '...') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return unchanged;
  }

  const metadataLines = lines.slice(1, closingIndex)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  const fields = metadataLines.map((line) => (
    line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
  ));
  if (
    !fields.length
    || fields.some((field) => !field)
    || !fields.some((field) => yamlFrontMatterKeys.has(field?.[1].toLowerCase() ?? ''))
  ) {
    return unchanged;
  }

  const metadata = new Map<string, string>();
  fields.forEach((field) => {
    if (field) {
      metadata.set(field[1].toLowerCase(), field[2]);
    }
  });
  const readText = (key: string) => {
    const value = metadata.get(key)?.trim();
    const quote = value?.[0];

    if (!value) {
      return undefined;
    }
    if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
      return value.slice(1, -1).trim() || undefined;
    }
    return value;
  };

  const contentLines = lines.slice(closingIndex + 1);
  if (!contentLines[0]) {
    contentLines.shift();
  }
  return {
    source: contentLines.join('\n'),
    title: readText('title'),
    author: readText('author') ?? readText('creator'),
    cover: readText('cover'),
    docType: readText('doc_type'),
  };
};

const cleanWereadMarkdown = (source: string) => {
  let cleaned = source.replace(
    /^#\s+元数据\s*$[\s\S]*?(?=^#\s+(?:高亮划线|读书笔记|本书评论)\s*$)/mu,
    '',
  )
  .replace(/^#\s+高亮划线\s*$/gmu, '')
  .replace(/^>\s*⏱.*$/gmu, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

  while (/(?:^|\n)#\s+(?:读书笔记|本书评论)\s*$/u.test(cleaned)) {
    cleaned = cleaned.replace(
      /(?:^|\n)#\s+(?:读书笔记|本书评论)\s*$/u,
      '',
    ).trim();
  }
  return cleaned;
};

const parseMarkdownContent = (tree: Root, title: string) => {
  const paragraphs: string[] = [];
  const chapters: ImportedBookChapter[] = [];
  const formats: ImportedBookFormat[] = [];
  let firstTitleHeadingHandled = false;
  let nextGroupId = 1;

  type InlineBlockFormat = Extract<
    ImportedBookFormat,
    { kind: 'heading' | 'list-item' | 'blockquote' }
  >;

  const appendInlineBlock = (
    runs: ImportedInlineRun[],
    createFormat?: (paragraphIndex: number) => InlineBlockFormat,
  ) => {
    const normalizedRuns = trimInlineRuns(runs);
    const text = inlineRunsText(normalizedRuns);
    if (!text.trim()) {
      return;
    }

    const hasInlineFormatting = normalizedRuns.some((run) => (
      run.kind !== 'text' || run.marks?.length
    ));
    if (!createFormat && !hasInlineFormatting) {
      paragraphs.push(text);
      return;
    }

    const paragraphIndex = paragraphs.length;

    paragraphs.push(text);
    if (createFormat) {
      const format = createFormat(paragraphIndex);

      formats.push(hasInlineFormatting
        ? { ...format, inlines: normalizedRuns }
        : format);
    } else {
      formats.push({ kind: 'rich-text', paragraphIndex, inlines: normalizedRuns });
    }
  };
  const appendCodeBlock = (value: string, language: string) => {
    const paragraphIndex = paragraphs.length;

    paragraphs.push(value || ' ');
    formats.push({
      kind: 'code-block',
      paragraphIndex,
      language: language.slice(0, 48),
    });
  };
  const appendMathBlock = (value: string) => {
    const paragraphIndex = paragraphs.length;

    paragraphs.push(value.trim() || ' ');
    formats.push({ kind: 'math-block', paragraphIndex });
  };
  const appendHeading = (
    runs: ImportedInlineRun[],
    level: MarkdownHeadingLevel,
  ) => {
    const headingTitle = inlineRunsText(runs).trim();
    const isTitleHeading = level === 1
      && !firstTitleHeadingHandled
      && headingTitle === title;

    if (!headingTitle) {
      return;
    }
    if (isTitleHeading) {
      firstTitleHeadingHandled = true;
      return;
    }

    const paragraphIndex = paragraphs.length;

    if (level <= 3) {
      chapters.push({
        title: headingTitle,
        level: level as 1 | 2 | 3,
        paragraphIndex,
      });
    }
    appendInlineBlock(
      runs,
      (index) => ({ kind: 'heading', paragraphIndex: index, level }),
    );
  };
  const appendTableRow = (
    cells: string[],
    cellInlines: Array<ImportedInlineRun[] | null>,
    alignments: TableAlignment[],
    groupId: number,
    header: boolean,
  ) => {
    const text = cells.join(' ｜ ').trim() || '—';
    const paragraphIndex = paragraphs.length;

    paragraphs.push(text);
    formats.push({
      kind: 'table-row',
      paragraphIndex,
      groupId,
      header,
      cells,
      ...(cellInlines.some(Boolean) ? { cellInlines } : {}),
      alignments,
    });
  };
  const appendTable = (table: Table) => {
    const groupId = nextGroupId;
    const alignments = table.align.map((alignment) => alignment ?? 'left');

    nextGroupId += 1;
    table.children.forEach((row, rowIndex) => {
      const runsByCell = row.children.map((cell) => normalizeInlineRuns(cell.children));
      const cells = runsByCell.map(inlineRunsText);
      const cellInlines = runsByCell.map((runs) => (
        runs.some((run) => run.kind !== 'text' || run.marks?.length) ? runs : null
      ));
      const rowAlignments = cells.map((_, index) => alignments[index] ?? 'left');

      appendTableRow(cells, cellInlines, rowAlignments, groupId, rowIndex === 0);
    });
  };
  const collectListItemRuns = (item: ListItem) => {
    const runs: ImportedInlineRun[] = [];

    item.children.forEach((child) => {
      if (child.type === 'list') {
        return;
      }
      const childRuns: ImportedInlineRun[] = [];
      if (child.type === 'paragraph' || child.type === 'heading') {
        collectInlineRuns(child.children, childRuns);
      } else if (child.type === 'code') {
        appendInlineRun(childRuns, 'code', child.value);
      } else if (child.type === 'math') {
        appendInlineRun(childRuns, 'math', child.value);
      } else if (child.type === 'blockquote') {
        child.children.forEach((quoteChild) => {
          if (quoteChild.type === 'paragraph' || quoteChild.type === 'heading') {
            if (childRuns.length) {
              appendInlineRun(childRuns, 'break', '\n');
            }
            collectInlineRuns(quoteChild.children, childRuns);
          }
        });
      }
      if (trimInlineRuns(childRuns).length) {
        if (runs.length) {
          appendInlineRun(runs, 'break', '\n');
        }
        runs.push(...childRuns);
      }
    });
    return trimInlineRuns(runs);
  };
  const appendList = (list: List, groupId: number, depth = 0) => {
    const ordered = Boolean(list.ordered);
    const start = list.start ?? 1;

    list.children.forEach((item, index) => {
      const runs = collectListItemRuns(item);
      const paragraphIndex = paragraphs.length;

      if (runs.length) {
        appendInlineBlock(
          runs,
          (nextParagraphIndex) => ({
            kind: 'list-item',
            paragraphIndex: nextParagraphIndex,
            groupId,
            ordered,
            ordinal: ordered ? start + index : index + 1,
            depth: Math.min(depth, 6),
            ...(item.checked === null ? {} : { checked: item.checked }),
          }),
        );
      } else {
        paragraphs.push(' ');
        formats.push({
          kind: 'list-item',
          paragraphIndex,
          groupId,
          ordered,
          ordinal: ordered ? start + index : index + 1,
          depth: Math.min(depth, 6),
          ...(item.checked === null ? {} : { checked: item.checked }),
        });
      }

      item.children.forEach((child) => {
        if (child.type === 'list') {
          appendList(child, groupId, depth + 1);
        }
      });
    });
  };
  const processBlocks = (nodes: readonly RootContent[], quoted = false) => {
    nodes.forEach((node) => {
      if (node.type === 'paragraph') {
        appendInlineBlock(
          normalizeInlineRuns(node.children),
          quoted
            ? (paragraphIndex) => ({ kind: 'blockquote', paragraphIndex })
            : undefined,
        );
      } else if (node.type === 'heading') {
        appendHeading(
          normalizeInlineRuns(node.children),
          node.depth as MarkdownHeadingLevel,
        );
      } else if (node.type === 'code') {
        appendCodeBlock(node.value, node.lang ?? '');
      } else if (node.type === 'math') {
        appendMathBlock(node.value);
      } else if (node.type === 'blockquote') {
        processBlocks(node.children, true);
      } else if (node.type === 'list') {
        const groupId = nextGroupId;

        nextGroupId += 1;
        appendList(node, groupId);
      } else if (node.type === 'table') {
        appendTable(node);
      } else if (node.type === 'thematicBreak') {
        const paragraphIndex = paragraphs.length;

        paragraphs.push('—');
        formats.push({ kind: 'thematic-break', paragraphIndex });
      } else if (node.type === 'html') {
        const text = normalizePlainText(node.value.replace(/<[^>]*>/g, ' '));

        if (text) {
          paragraphs.push(text);
        }
      } else if (node.type === 'footnoteDefinition') {
        processBlocks(node.children, true);
      }
    });
  };

  processBlocks(tree.children);
  return { paragraphs, chapters, formats };
};

const plainTextChapterNumber = String.raw`[\p{Script=Han}〇零一二三四五六七八九十百千万\d]+`;
const plainTextHeadingPattern = new RegExp(
  String.raw`^(?:第${plainTextChapterNumber}[章节回部卷篇](?:\s+.*)?`
    + String.raw`|卷[\p{Script=Han}\d]+(?:\s+.*)?`
    + String.raw`|序章|序言|前言|楔子|尾声|后记|跋`
    + String.raw`|Chapter\s+\d+(?:[.:：\s].*)?)$`,
  'iu',
);
const plainTextListPattern = /^(\s*)(?:(\d{1,4})[.)、]|[-+*•])\s+(.+)$/u;
const plainTextSceneBreakPattern = /^\s*(?:[-—–_=＊*·•]\s*){3,}$/u;
const plainTextTerminalPattern = /[。！？!?；;…][”’"'）》】〕」』]*$/u;
const cjkBoundaryPattern = /[\u2e80-\u9fff\uf900-\ufaff]/u;
const plainTextCodePattern = new RegExp(
  String.raw`(?:[{};]|=>`
    + String.raw`|^\s*(?:const|let|var|function|class|interface|type|import|export)\b`
    + String.raw`|^\s*(?:def|from|if|for|while|return)\b`
    + String.raw`|^\s*#include\b`
    + String.raw`|^\s*[\w.[\]'"-]+\s*=\s*\S)`,
  'iu',
);

const medianOf = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const looksPreformattedText = (lines: readonly string[]) => {
  const indented = lines.filter((line) => /^(?:\t| {4})/.test(line)).length;
  const codeSyntax = lines.filter((line) => (
    plainTextCodePattern.test(line)
  )).length;
  const columnar = lines.filter((line) => (
    line.includes('\t') || /\S(?: {2,}\S){2,}/u.test(line)
  )).length;
  const logs = lines.filter((line) => (
    /^\s*(?:\d{4}-\d{2}-\d{2}|\[?\d{2}:\d{2}:\d{2}|TRACE\b|DEBUG\b|INFO\b|WARN\b|ERROR\b)/i
      .test(line)
  )).length;

  return /^\s*(?:```|~~~)/.test(lines[0] ?? '')
    || (
      lines.length > 1
      && indented >= Math.max(2, Math.ceil(lines.length * 0.5))
      && codeSyntax >= Math.max(1, Math.ceil(lines.length * 0.25))
    )
    || columnar >= Math.max(2, Math.ceil(lines.length * 0.6))
    || logs >= Math.max(2, Math.ceil(lines.length * 0.6));
};

const looksHardWrappedProse = (lines: readonly string[]) => {
  if (lines.length < 3 || looksPreformattedText(lines)) {
    return false;
  }
  const trimmed = lines.map((line) => line.trim());
  if (
    trimmed.some((line) => (
      plainTextHeadingPattern.test(line)
      || plainTextListPattern.test(line)
      || plainTextSceneBreakPattern.test(line)
    ))
  ) {
    return false;
  }
  const lengths = trimmed.map(unicodeLength);
  const median = medianOf(lengths);
  const regularLines = lengths.slice(0, -1).filter((length) => (
    length >= median * 0.7 && length <= median * 1.35
  )).length;
  const terminalLines = trimmed.slice(0, -1).filter((line) => (
    plainTextTerminalPattern.test(line)
  )).length;
  const prosePunctuationLines = trimmed.slice(0, -1).filter((line) => (
    /[，,；;：:]/u.test(line)
  )).length;
  const lastLineIsShort = (lengths.at(-1) ?? median) <= median * 0.82;

  return median >= 32
    && regularLines >= Math.ceil((lines.length - 1) * 0.75)
    && terminalLines <= Math.floor((lines.length - 1) * 0.45)
    && prosePunctuationLines >= Math.ceil((lines.length - 1) * 0.25)
    && lastLineIsShort;
};

const joinPlainTextLines = (left: string, right: string) => {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  const leftCharacter = normalizedLeft.at(-1) ?? '';
  const rightCharacter = normalizedRight[0] ?? '';
  const separator = cjkBoundaryPattern.test(leftCharacter)
    || cjkBoundaryPattern.test(rightCharacter)
    ? ''
    : ' ';

  return `${normalizedLeft}${separator}${normalizedRight}`;
};

const preservedLineRuns = (lines: readonly string[]): ImportedInlineRun[] => (
  lines.flatMap((line, index) => [
    ...(index ? [{ kind: 'break', value: '\n' } as ImportedInlineRun] : []),
    { kind: 'text', value: line.trim().normalize('NFC') } as ImportedInlineRun,
  ])
);

const parsePlainTextContent = (source: string, title: string) => {
  const paragraphs: string[] = [];
  const chapters: ImportedBookChapter[] = [];
  const formats: ImportedBookFormat[] = [];
  let nextGroupId = 1;

  const appendParagraph = (text: string, runs?: ImportedInlineRun[]) => {
    const normalized = text.normalize('NFC').trim();
    if (!normalized || normalized === title) {
      return;
    }
    const paragraphIndex = paragraphs.length;

    paragraphs.push(normalized);
    if (runs) {
      formats.push({ kind: 'rich-text', paragraphIndex, inlines: runs });
    }
  };

  source.split(/\n[ \t]*\n+/).forEach((block) => {
    const lines = block.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
    if (!lines.length) {
      return;
    }
    const trimmed = lines.map((line) => line.trim());
    const heading = trimmed.length === 1 && plainTextHeadingPattern.test(trimmed[0]);
    if (heading) {
      if (trimmed[0] !== title) {
        const paragraphIndex = paragraphs.length;

        paragraphs.push(trimmed[0]);
        chapters.push({ title: trimmed[0], level: 1, paragraphIndex });
        formats.push({ kind: 'heading', paragraphIndex, level: 2 });
      }
      return;
    }
    if (trimmed.length === 1 && plainTextSceneBreakPattern.test(trimmed[0])) {
      const paragraphIndex = paragraphs.length;

      paragraphs.push('—');
      formats.push({ kind: 'thematic-break', paragraphIndex });
      return;
    }
    const listMatches = lines.map((line) => line.match(plainTextListPattern));
    if (listMatches.every(Boolean)) {
      const groupId = nextGroupId;

      nextGroupId += 1;
      listMatches.forEach((match, index) => {
        if (!match) {
          return;
        }
        const paragraphIndex = paragraphs.length;
        const ordered = Boolean(match[2]);

        paragraphs.push(match[3].trim());
        formats.push({
          kind: 'list-item',
          paragraphIndex,
          groupId,
          ordered,
          ordinal: ordered ? Number(match[2]) : index + 1,
          depth: Math.min(Math.floor(match[1].replace(/\t/g, '  ').length / 2), 6),
        });
      });
      return;
    }
    if (looksPreformattedText(lines)) {
      const paragraphIndex = paragraphs.length;
      const fence = /^\s*(```|~~~)/.exec(lines[0]);
      const content = fence
        && lines.length > 1
        && lines.at(-1)?.trim().startsWith(fence[1])
        ? lines.slice(1, -1)
        : lines;

      paragraphs.push(content.join('\n').normalize('NFC') || ' ');
      formats.push({ kind: 'code-block', paragraphIndex, language: '' });
      return;
    }
    if (trimmed.length === 1) {
      appendParagraph(trimmed[0]);
      return;
    }
    if (looksHardWrappedProse(lines)) {
      appendParagraph(trimmed.reduce(joinPlainTextLines));
      return;
    }
    const text = trimmed.join('\n').normalize('NFC');

    appendParagraph(text, preservedLineRuns(trimmed));
  });

  return { paragraphs, chapters, formats };
};

const importedContentsTitlePattern = /^(?:目录|目次|目录页|contents|table\s+of\s+contents)$/iu;

const stripImportedContents = (
  content: ReturnType<typeof parsePlainTextContent>,
) => {
  const formatByParagraph = new Map(
    content.formats.map((format) => [format.paragraphIndex, format]),
  );
  const searchLimit = Math.min(80, Math.max(8, Math.ceil(content.paragraphs.length * 0.15)));
  const start = content.paragraphs.findIndex((paragraph, index) => {
    if (index >= searchLimit || !importedContentsTitlePattern.test(paragraph.trim())) {
      return false;
    }
    return formatByParagraph.get(index)?.kind === 'heading' || index < 5;
  });

  if (start < 0) {
    return content;
  }

  const nextHeading = content.formats
    .filter((format) => format.kind === 'heading' && format.paragraphIndex > start)
    .sort((left, right) => left.paragraphIndex - right.paragraphIndex)[0];
  let end = nextHeading?.paragraphIndex;

  if (end === undefined) {
    let cursor = start + 1;
    let entryCount = 0;

    while (cursor < content.paragraphs.length) {
      const paragraph = content.paragraphs[cursor];
      const format = formatByParagraph.get(cursor);
      const indexEntry = format?.kind === 'list-item'
        || format?.kind === 'table-row'
        || /(?:\.{2,}|…{2,}|·{2,}|\s)\s*\d{1,4}$/u.test(paragraph);

      if (!indexEntry) {
        break;
      }
      entryCount += 1;
      cursor += 1;
    }
    if (entryCount < 2) {
      return content;
    }
    end = cursor;
  }

  const removedCount = end - start;
  const remapIndex = (paragraphIndex: number) => (
    paragraphIndex < start ? paragraphIndex : paragraphIndex - removedCount
  );
  const paragraphs = content.paragraphs.filter((_, index) => (
    index < start || index >= end
  ));
  const chapters = content.chapters.flatMap((chapter): ImportedBookChapter[] => (
    chapter.paragraphIndex >= start && chapter.paragraphIndex < end
      ? []
      : [{ ...chapter, paragraphIndex: remapIndex(chapter.paragraphIndex) }]
  ));
  const formats = content.formats.flatMap((format): ImportedBookFormat[] => (
    format.paragraphIndex >= start && format.paragraphIndex < end
      ? []
      : [{ ...format, paragraphIndex: remapIndex(format.paragraphIndex) }]
  ));

  return { paragraphs, chapters, formats };
};

const hashTitle = (title: string) => Array.from(title)
  .reduce((hash, character) => hash + (character.codePointAt(0) ?? 0), 0);

const createBookId = async (title: string, source: string) => {
  const bytes = new TextEncoder().encode(`${title}\0${source}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `imported-${fingerprint}`;
};

export const parseImportedBook = async (
  file: File,
  options: ParseImportedBookOptions = {},
): Promise<ImportedBookRecord> => {
  const document = await readDocumentFile(file, {
    onProgress: (progress) => options.onProgress?.(progress * 0.72),
  });
  const markdownDocument: MarkdownFrontMatter = document.markdown
    ? readConservativeYamlFrontMatter(document.source)
    : { source: document.source };
  const cleaned = markdownDocument.docType === 'weread-highlights-reviews'
    ? cleanWereadMarkdown(markdownDocument.source)
    : markdownDocument.source;
  const markdownTree = document.markdown ? parseMarkdownAst(cleaned) : undefined;
  const markdownTitle = markdownTree ? findMarkdownTitle(markdownTree) : undefined;
  const fileTitle = file.name.replace(/\.(?:txt|md|markdown|pdf|epub)$/i, '').trim();
  const title = truncateUnicode(
    normalizePlainText(
      document.title
      || markdownDocument.title
      || markdownTitle
      || fileTitle
      || '未命名书籍',
    ),
    48,
  );
  const parsedContent = document.pdf
    ? {
        paragraphs: document.pdf.pageNumbers.map((pageNumber) => `第 ${pageNumber} 页`),
        chapters: document.pdf.outline.flatMap((chapter, index, outline) => {
          const paragraphIndex = document.pdf?.pageNumbers.findIndex(
            (pageNumber) => pageNumber >= chapter.pageNumber,
          ) ?? -1;
          const duplicate = outline.slice(0, index).some((candidate) => (
            candidate.title === chapter.title
            && candidate.pageNumber === chapter.pageNumber
          ));

          return paragraphIndex >= 0 && !duplicate
            ? [{
                title: chapter.title,
                level: chapter.level,
                paragraphIndex,
              }]
            : [];
        }),
        formats: [],
      }
    : stripImportedContents(
        markdownTree
          ? parseMarkdownContent(markdownTree, title)
          : parsePlainTextContent(cleaned, title),
      );
  const { paragraphs, chapters, formats } = parsedContent;
  options.onProgress?.(0.84);

  if (!paragraphs.length) {
    throw new Error('文件中没有可阅读的正文');
  }

  const id = await createBookId(
    title,
    document.pdf?.fingerprint ?? document.source,
  );
  options.onProgress?.(1);
  const cover = document.cover ?? normalizeWereadCoverUrl(markdownDocument.cover);

  return {
    id,
    title,
    author: truncateUnicode(
      normalizePlainText(document.author || markdownDocument.author || '本地导入'),
      48,
    ),
    color: coverColors[hashTitle(title) % coverColors.length],
    ...(cover ? { cover } : {}),
    chapterTitle: title,
    sourceName: truncateUnicode(file.name, 512),
    paragraphs,
    chapters,
    formats,
    ...(document.pdf ? {
      pdf: {
        file: document.pdf.file,
        fingerprint: document.pdf.fingerprint,
        pageCount: document.pdf.pageCount,
        pageNumbers: document.pdf.pageNumbers,
      },
    } : {}),
    sourceFormat: file.name.toLowerCase().endsWith('.txt')
      ? 'txt'
      : file.name.toLowerCase().endsWith('.pdf')
        ? 'pdf'
        : file.name.toLowerCase().endsWith('.epub')
          ? 'epub'
          : 'markdown',
    imported: true,
    createdAt: Date.now(),
  };
};

const sortMetadata = (books: ImportedBookMetadata[]) => books.sort(
  (left, right) => left.createdAt - right.createdAt,
);

export const loadImportedBookMetadata = async (): Promise<ImportedBookMetadata[]> => {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, CONTENT_STORE_NAME],
      'readonly',
    );
    const [values, contentKeys] = await completeTransaction(
      transaction,
      Promise.all([
        requestValue(transaction.objectStore(METADATA_STORE_NAME).getAll()),
        requestValue(transaction.objectStore(CONTENT_STORE_NAME).getAllKeys()),
      ]),
    );
    const contentIds = new Set(contentKeys.filter(
      (key): key is string => typeof key === 'string',
    ));

    return sortMetadata(values
      .map((value) => readStoredMetadata(value))
      .filter((book): book is ImportedBookMetadata => (
        book !== null && contentIds.has(book.id)
      )));
  } finally {
    database.close();
  }
};

export const loadImportedBooks = async (): Promise<ImportedBookRecord[]> => {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, CONTENT_STORE_NAME],
      'readonly',
    );
    const [metadataValues, contentValues] = await completeTransaction(
      transaction,
      Promise.all([
        requestValue(transaction.objectStore(METADATA_STORE_NAME).getAll()),
        requestValue(transaction.objectStore(CONTENT_STORE_NAME).getAll()),
      ]),
    );
    const contentById = new Map<string, StoredBookContent>();

    contentValues.forEach((value) => {
      const content = readStoredContent(value);

      if (content) {
        contentById.set(content.id, content);
      }
    });

    return sortMetadata(metadataValues
      .map((value) => readStoredMetadata(value))
      .filter((book): book is ImportedBookMetadata => book !== null))
      .flatMap((metadata): ImportedBookRecord[] => {
        const content = contentById.get(metadata.id);

        return content
          ? [{
              ...metadata,
              paragraphs: content.paragraphs,
              chapters: content.chapters,
              formats: content.formats,
              ...(content.pdf ? { pdf: content.pdf } : {}),
            }]
          : [];
      });
  } finally {
    database.close();
  }
};

export const loadImportedBook = async (id: string): Promise<ImportedBookRecord> => {
  if (!id) {
    throw new Error('书籍 ID 不能为空');
  }

  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, CONTENT_STORE_NAME],
      'readonly',
    );
    const [metadataValue, contentValue] = await completeTransaction(
      transaction,
      Promise.all([
        requestValue(transaction.objectStore(METADATA_STORE_NAME).get(id)),
        requestValue(transaction.objectStore(CONTENT_STORE_NAME).get(id)),
      ]),
    );

    if (metadataValue === undefined) {
      throw new Error(`未找到书籍：${id}`);
    }

    const metadata = readStoredMetadata(metadataValue);
    if (!metadata) {
      throw new Error(`书籍元数据已损坏：${id}`);
    }

    const content = readStoredContent(contentValue);
    if (!content || content.id !== metadata.id) {
      throw new Error(`书籍正文数据已损坏：${id}`);
    }

    return {
      ...metadata,
      paragraphs: content.paragraphs,
      chapters: content.chapters,
      formats: content.formats,
      ...(content.pdf ? { pdf: content.pdf } : {}),
    };
  } finally {
    database.close();
  }
};

export const saveImportedBook = async (book: ImportedBookRecord): Promise<void> => {
  if (!readImportedBook(book)) {
    throw new Error('无法保存损坏的书籍数据');
  }

  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, CONTENT_STORE_NAME],
      'readwrite',
    );

    await completeTransaction(
      transaction,
      Promise.all([
        requestValue(
          transaction.objectStore(METADATA_STORE_NAME).put(toStoredMetadata(book)),
        ),
        requestValue(
          transaction.objectStore(CONTENT_STORE_NAME).put(toStoredContent(book)),
        ),
      ]).then((): void => undefined),
    );
  } finally {
    database.close();
  }
};

export const deleteImportedBook = async (id: string): Promise<ImportedBookRecord> => {
  if (!id) {
    throw new Error('书籍 ID 不能为空');
  }

  const database = await openDatabase();

  try {
    return await new Promise<ImportedBookRecord>((resolve, reject) => {
      const transaction = database.transaction(
        [METADATA_STORE_NAME, CONTENT_STORE_NAME],
        'readwrite',
      );
      const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
      const contentStore = transaction.objectStore(CONTENT_STORE_NAME);
      const metadataRequest = metadataStore.get(id);
      const contentRequest = contentStore.get(id);
      let metadataValue: unknown;
      let contentValue: unknown;
      let metadataReady = false;
      let contentReady = false;
      let deleteStarted = false;
      let deletedBook: ImportedBookRecord | undefined;
      let failure: Error | undefined;

      const abort = (error: Error) => {
        failure = error;
        transaction.abort();
      };
      const deleteWhenReady = () => {
        if (!metadataReady || !contentReady || deleteStarted) {
          return;
        }

        deleteStarted = true;
        if (metadataValue === undefined) {
          abort(new Error(`未找到书籍：${id}`));
          return;
        }

        const metadata = readStoredMetadata(metadataValue);
        if (!metadata) {
          abort(new Error(`书籍元数据已损坏：${id}`));
          return;
        }

        const content = readStoredContent(contentValue);
        if (!content || content.id !== metadata.id) {
          abort(new Error(`书籍正文数据已损坏：${id}`));
          return;
        }

        deletedBook = {
          ...metadata,
          paragraphs: content.paragraphs,
          chapters: content.chapters,
          formats: content.formats,
          ...(content.pdf ? { pdf: content.pdf } : {}),
        };
        metadataStore.delete(id);
        contentStore.delete(id);
      };

      metadataRequest.onsuccess = () => {
        metadataValue = metadataRequest.result;
        metadataReady = true;
        deleteWhenReady();
      };
      metadataRequest.onerror = () => {
        failure = databaseError('无法读取待删除书籍的元数据', metadataRequest.error);
      };
      contentRequest.onsuccess = () => {
        contentValue = contentRequest.result;
        contentReady = true;
        deleteWhenReady();
      };
      contentRequest.onerror = () => {
        failure = databaseError('无法读取待删除书籍的正文', contentRequest.error);
      };
      transaction.oncomplete = () => {
        if (deletedBook) {
          resolve(deletedBook);
        } else {
          reject(new Error(`删除书籍失败：${id}`));
        }
      };
      transaction.onerror = () => {
        failure ??= databaseError('删除书籍事务失败', transaction.error);
      };
      transaction.onabort = () => reject(
        failure ?? databaseError('删除书籍事务已中止', transaction.error),
      );
    });
  } finally {
    database.close();
  }
};
