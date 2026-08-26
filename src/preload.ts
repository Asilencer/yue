import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  DataMigrationMode,
  DataMigrationPayload,
  ReaderCommand,
} from './global';

const READER_COMMAND_CHANNEL = 'reader-command';
const DATA_MIGRATION_MODE_CHANNEL = 'data-migration:mode';
const DATA_MIGRATION_SAVE_CHANNEL = 'data-migration:save';
const DATA_MIGRATION_READ_CHANNEL = 'data-migration:read';
const DATA_MIGRATION_COMPLETE_CHANNEL = 'data-migration:complete';
const DATA_MIGRATION_FAIL_CHANNEL = 'data-migration:fail';
const readerCommands = new Set<ReaderCommand>([
  'open-book',
  'toggle-bookmark',
]);

const isReaderCommand = (value: unknown): value is ReaderCommand => (
  typeof value === 'string' && readerCommands.has(value as ReaderCommand)
);

contextBridge.exposeInMainWorld('yue', {
  dataMigrationMode: ipcRenderer.sendSync(
    DATA_MIGRATION_MODE_CHANNEL,
  ) as DataMigrationMode,
  saveDataMigration: (payload: DataMigrationPayload) => (
    ipcRenderer.invoke(DATA_MIGRATION_SAVE_CHANNEL, payload) as Promise<void>
  ),
  readDataMigration: () => (
    ipcRenderer.invoke(DATA_MIGRATION_READ_CHANNEL) as Promise<DataMigrationPayload>
  ),
  completeDataMigration: () => (
    ipcRenderer.invoke(DATA_MIGRATION_COMPLETE_CHANNEL) as Promise<void>
  ),
  failDataMigration: (message: string) => (
    ipcRenderer.invoke(DATA_MIGRATION_FAIL_CHANNEL, message) as Promise<void>
  ),
  onReaderCommand: (listener: (command: ReaderCommand) => void) => {
    const handler = (_event: IpcRendererEvent, command: unknown) => {
      if (isReaderCommand(command)) {
        listener(command);
      }
    };

    ipcRenderer.on(READER_COMMAND_CHANNEL, handler);
    return () => ipcRenderer.removeListener(READER_COMMAND_CHANNEL, handler);
  },
});
