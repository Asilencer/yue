import type { ImportedBookRecord } from './library-store';

export type ReaderCommand =
  | 'open-book'
  | 'toggle-bookmark';

export type DataMigrationMode = 'none' | 'export' | 'import';

export type DataMigrationPayload = {
  localStorage: Record<string, string>;
  books: ImportedBookRecord[];
};

export interface YueApi {
  dataMigrationMode: DataMigrationMode;
  saveDataMigration: (payload: DataMigrationPayload) => Promise<void>;
  readDataMigration: () => Promise<DataMigrationPayload>;
  completeDataMigration: () => Promise<void>;
  failDataMigration: (message: string) => Promise<void>;
  onReaderCommand: (
    listener: (command: ReaderCommand) => void,
  ) => () => void;
}

declare global {
  interface Window {
    yue: YueApi;
  }
}
