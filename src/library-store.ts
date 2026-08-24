export type ImportedBookRecord = {
  id: string;
  title: string;
  author: string;
  color: string;
  chapterTitle: string;
  paragraphs: string[];
  imported: true;
  createdAt: number;
};

export type ImportedBookMetadata = Omit<ImportedBookRecord, 'paragraphs'>;

const DATABASE_NAME = 'yuguang-library';
const DATABASE_VERSION = 2;
const METADATA_STORE_NAME = 'books';
const CONTENT_STORE_NAME = 'bookContents';
const SCHEMA_VERSION = 2;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const supportedExtensions = new Set(['txt', 'md', 'markdown']);
const coverColors = ['#5276c7', '#5c7f70', '#ef8b74', '#c99a52', '#6b657f'];

type StoredBookMetadata = ImportedBookMetadata & {
  schemaVersion: typeof SCHEMA_VERSION;
};

type StoredBookContent = {
  id: string;
  paragraphs: string[];
  schemaVersion: typeof SCHEMA_VERSION;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readBookMetadata = (value: unknown): ImportedBookMetadata | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { id, title, author, color, chapterTitle, imported, createdAt } = value;
  if (
    typeof id !== 'string'
    || !id
    || typeof title !== 'string'
    || !title
    || typeof author !== 'string'
    || typeof color !== 'string'
    || typeof chapterTitle !== 'string'
    || imported !== true
    || typeof createdAt !== 'number'
    || !Number.isFinite(createdAt)
    || createdAt < 0
  ) {
    return null;
  }

  return { id, title, author, color, chapterTitle, imported, createdAt };
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

  return { ...metadata, paragraphs };
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

  return {
    id: value.id,
    paragraphs: value.paragraphs,
    schemaVersion: SCHEMA_VERSION,
  };
};

const toStoredMetadata = (book: ImportedBookRecord): StoredBookMetadata => ({
  id: book.id,
  title: book.title,
  author: book.author,
  color: book.color,
  chapterTitle: book.chapterTitle,
  imported: true,
  createdAt: book.createdAt,
  schemaVersion: SCHEMA_VERSION,
});

const toStoredContent = (book: ImportedBookRecord): StoredBookContent => ({
  id: book.id,
  paragraphs: book.paragraphs,
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

const normalizeInlineMarkdown = (value: string) => value
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]\s)\s*/gm, '')
  .replace(/[*_~`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const splitLongParagraph = (paragraph: string) => {
  if (paragraph.length <= 420) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [paragraph];
  const chunks: string[] = [];
  let current = '';

  sentences.forEach((sentence) => {
    if (current && current.length + sentence.length > 320) {
      chunks.push(current.trim());
      current = '';
    }

    if (sentence.length > 420) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }

      for (let offset = 0; offset < sentence.length; offset += 320) {
        const part = sentence.slice(offset, offset + 320).trim();
        if (part) {
          chunks.push(part);
        }
      }
      return;
    }

    current += sentence;
  });

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
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

export const parseImportedBook = async (file: File): Promise<ImportedBookRecord> => {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (!supportedExtensions.has(extension)) {
    throw new Error('目前支持 TXT 和 Markdown');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('单本文件暂时不能超过 2 MB');
  }

  let decoded: string;

  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本');
  }

  if (decoded.includes('\0')) {
    throw new Error('文件包含不支持的二进制内容');
  }

  const source = decoded.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const markdownTitle = extension !== 'txt'
    ? source.match(/^\s{0,3}#\s+(.+)$/m)?.[1]?.trim()
    : undefined;
  const fileTitle = file.name.replace(/\.(?:txt|md|markdown)$/i, '').trim();
  const title = normalizeInlineMarkdown(markdownTitle || fileTitle || '未命名书籍').slice(0, 48);
  const cleaned = extension === 'txt'
    ? source
    : source
      .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s{0,3}#\s+.+$/m, '');
  const paragraphs = cleaned
    .split(/\n\s*\n+/)
    .map((paragraph) => normalizeInlineMarkdown(paragraph.replace(/\n+/g, ' ')))
    .filter((paragraph) => paragraph && paragraph !== title)
    .flatMap(splitLongParagraph);

  if (!paragraphs.length) {
    throw new Error('文件中没有可阅读的正文');
  }

  return {
    id: await createBookId(title, source),
    title,
    author: '本地导入',
    color: coverColors[hashTitle(title) % coverColors.length],
    chapterTitle: title,
    paragraphs,
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

        return content ? [{ ...metadata, paragraphs: content.paragraphs }] : [];
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

    return { ...metadata, paragraphs: content.paragraphs };
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

        deletedBook = { ...metadata, paragraphs: content.paragraphs };
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
