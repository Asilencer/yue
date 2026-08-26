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

export type ImportedBookRecord = {
  id: string;
  title: string;
  author: string;
  color: string;
  cover?: string;
  paragraphs: string[];
  chapters: ImportedBookChapter[];
  formats: ImportedBookFormat[];
  sourceName?: string;
  sourceFormat: ImportedSourceFormat;
  imported: true;
  createdAt: number;
};

export type ImportedBookMetadata = Omit<
  ImportedBookRecord,
  'paragraphs' | 'chapters' | 'formats'
>;

export type ParseImportedBookOptions = {
  onProgress?: (progress: number) => void;
};

export type ImportedSourceFormat = 'epub';

const DATABASE_NAME = 'yue-library';
const LEGACY_DATABASE_NAME = 'yuguang-library';
const DATABASE_VERSION = 3;
const METADATA_STORE_NAME = 'books';
const CONTENT_STORE_NAME = 'bookContents';
const SCHEMA_VERSION = 2;
const COVER_DATA_URL_LIMIT = 3 * 1024 * 1024;
const coverColors = ['#5276c7', '#5c7f70', '#ef8b74', '#c99a52', '#6b657f'];

const isStoredCover = (value: string) => (
  value.length <= COVER_DATA_URL_LIMIT
  && /^data:image\/jpeg;base64,[a-z\d+/]+=*$/i.test(value)
);

type StoredBookMetadata = ImportedBookMetadata & {
  schemaVersion: typeof SCHEMA_VERSION;
};

type StoredBookContent = {
  id: string;
  paragraphs: string[];
  chapters: ImportedBookChapter[];
  formats: ImportedBookFormat[];
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
    || (
      sourceName !== undefined
      && (typeof sourceName !== 'string' || !sourceName || sourceName.length > 512)
    )
    || sourceFormat !== 'epub'
    || imported !== true
    || typeof createdAt !== 'number'
    || !Number.isFinite(createdAt)
    || createdAt < 0
  ) {
    return null;
  }

  return {
    id,
    title,
    author,
    color,
    ...(typeof cover === 'string' ? { cover } : {}),
    ...(typeof sourceName === 'string' ? { sourceName } : {}),
    sourceFormat,
    imported,
    createdAt,
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
  if (!chapters || !formats) {
    return null;
  }

  return {
    ...metadata,
    paragraphs,
    chapters,
    formats,
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
  if (!chapters || !formats) {
    return null;
  }

  return {
    id: value.id,
    paragraphs: value.paragraphs,
    chapters,
    formats,
    schemaVersion: SCHEMA_VERSION,
  };
};

const toStoredMetadata = (book: ImportedBookRecord): StoredBookMetadata => ({
  id: book.id,
  title: book.title,
  author: book.author,
  color: book.color,
  ...(book.cover ? { cover: book.cover } : {}),
  ...(book.sourceName ? { sourceName: book.sourceName } : {}),
  sourceFormat: book.sourceFormat,
  imported: true,
  createdAt: book.createdAt,
  schemaVersion: SCHEMA_VERSION,
});

const toStoredContent = (book: ImportedBookRecord): StoredBookContent => ({
  id: book.id,
  paragraphs: book.paragraphs,
  chapters: book.chapters,
  formats: book.formats,
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

const normalizeStoredEpub = (value: unknown) => {
  if (!isRecord(value)) {
    return undefined;
  }
  const legacyEpub = value.sourceFormat === undefined
    && typeof value.sourceName === 'string'
    && value.sourceName.toLowerCase().endsWith('.epub');

  return value.sourceFormat === 'epub' || legacyEpub
    ? { ...value, sourceFormat: 'epub' }
    : undefined;
};

const openDatabase = (name = DATABASE_NAME) => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(name, DATABASE_VERSION);
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

    if (event.oldVersion === 0) {
      return;
    }

    const retainedIds = new Set<IDBValidKey>();
    const cursorRequest = metadataStore.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;

      if (!cursor) {
        const contentCursorRequest = contentStore.openCursor();

        contentCursorRequest.onsuccess = () => {
          const contentCursor = contentCursorRequest.result;

          if (!contentCursor) {
            return;
          }
          if (!retainedIds.has(contentCursor.primaryKey)) {
            contentCursor.delete();
          }
          contentCursor.continue();
        };
        contentCursorRequest.onerror = () => transaction.abort();
        return;
      }

      const epubValue = normalizeStoredEpub(cursor.value);
      if (!epubValue) {
        cursor.delete();
        cursor.continue();
        return;
      }

      if (event.oldVersion === 1) {
        const legacyBook = readImportedBook(epubValue);

        if (!legacyBook) {
          cursor.delete();
          cursor.continue();
          return;
        }
        contentStore.put(toStoredContent(legacyBook));
        cursor.update(toStoredMetadata(legacyBook));
      } else if (cursor.value.sourceFormat !== 'epub') {
        cursor.update(epubValue);
      }
      retainedIds.add(cursor.primaryKey);
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

const truncateUnicode = (value: string, maximumLength: number) => (
  Array.from(value).slice(0, maximumLength).join('')
);

const conciseBookTitle = (value: string) => {
  if (Array.from(value).length <= 48) {
    return value;
  }
  const subtitleIndex = value.search(/[（(]/u);

  return subtitleIndex >= 4 ? value.slice(0, subtitleIndex).trim() : value;
};

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
    const alignments = (table.align ?? []).map((alignment) => alignment ?? 'left');
    const syntheticHeader = table.children[0]?.children.every((cell) => (
      !inlineRunsText(normalizeInlineRuns(cell.children)).trim()
    ));
    const rows = syntheticHeader ? table.children.slice(1) : table.children;

    nextGroupId += 1;
    rows.forEach((row, rowIndex) => {
      const runsByCell = row.children.map((cell) => normalizeInlineRuns(cell.children));
      const cells = runsByCell.map(inlineRunsText);
      const cellInlines = runsByCell.map((runs) => (
        runs.some((run) => run.kind !== 'text' || run.marks?.length) ? runs : null
      ));
      const rowAlignments = cells.map((_, index) => alignments[index] ?? 'left');

      appendTableRow(
        cells,
        cellInlines,
        rowAlignments,
        groupId,
        !syntheticHeader && rowIndex === 0,
      );
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

const hashTitle = (title: string) => Array.from(title)
  .reduce((hash, character) => hash + (character.codePointAt(0) ?? 0), 0);

const createBookId = async (title: string, author: string, source: string) => {
  const bytes = new TextEncoder().encode(`${title}\0${author}\0${source}`);
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
  const markdownTree = parseMarkdownAst(document.source);
  const markdownTitle = findMarkdownTitle(markdownTree);
  const fileTitle = file.name.replace(/\.epub$/i, '').trim();
  const title = truncateUnicode(
    normalizePlainText(
      conciseBookTitle(document.title ?? '')
      || markdownTitle
      || fileTitle
      || '未命名书籍',
    ),
    48,
  );
  const parsedContent = parseMarkdownContent(markdownTree, title);
  const { paragraphs, chapters, formats } = parsedContent;
  options.onProgress?.(0.84);

  if (!paragraphs.length) {
    throw new Error('文件中没有可阅读的正文');
  }

  const author = truncateUnicode(
    normalizePlainText(document.author || '本地导入'),
    48,
  );
  const id = await createBookId(title, author, document.source);
  options.onProgress?.(1);
  const { cover } = document;

  return {
    id,
    title,
    author,
    color: coverColors[hashTitle(title) % coverColors.length],
    ...(cover ? { cover } : {}),
    sourceName: truncateUnicode(file.name, 512),
    paragraphs,
    chapters,
    formats,
    sourceFormat: 'epub',
    imported: true,
    createdAt: Date.now(),
  };
};

const sortMetadata = (books: ImportedBookMetadata[]) => books.sort(
  (left, right) => left.createdAt - right.createdAt,
);

const loadImportedBookMetadataFromDatabase = async (
  databaseName: string,
): Promise<ImportedBookMetadata[]> => {
  const database = await openDatabase(databaseName);

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

export const loadImportedBookMetadata = () => (
  loadImportedBookMetadataFromDatabase(DATABASE_NAME)
);

const loadImportedBookFromDatabase = async (
  databaseName: string,
  id: string,
): Promise<ImportedBookRecord> => {
  if (!id) {
    throw new Error('书籍 ID 不能为空');
  }

  const database = await openDatabase(databaseName);

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
    };
  } finally {
    database.close();
  }
};

export const loadImportedBook = (id: string) => (
  loadImportedBookFromDatabase(DATABASE_NAME, id)
);

export const exportLegacyImportedBooks = async (): Promise<ImportedBookRecord[]> => {
  const databases = await indexedDB.databases();

  if (!databases.some((database) => database.name === LEGACY_DATABASE_NAME)) {
    return [];
  }
  const metadata = await loadImportedBookMetadataFromDatabase(LEGACY_DATABASE_NAME);

  return Promise.all(metadata.map((book) => (
    loadImportedBookFromDatabase(LEGACY_DATABASE_NAME, book.id)
  )));
};

export const saveImportedBook = async (
  book: ImportedBookRecord,
  replaceExisting = false,
): Promise<void> => {
  if (!readImportedBook(book)) {
    throw new Error('无法保存损坏的书籍数据');
  }

  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, CONTENT_STORE_NAME],
      'readwrite',
    );
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
    const contentStore = transaction.objectStore(CONTENT_STORE_NAME);
    const writeMetadata = replaceExisting
      ? metadataStore.put(toStoredMetadata(book))
      : metadataStore.add(toStoredMetadata(book));
    const writeContent = replaceExisting
      ? contentStore.put(toStoredContent(book))
      : contentStore.add(toStoredContent(book));

    await completeTransaction(
      transaction,
      Promise.all([
        requestValue(writeMetadata),
        requestValue(writeContent),
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
