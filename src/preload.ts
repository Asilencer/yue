import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ReaderCommand } from './global';

const READER_COMMAND_CHANNEL = 'reader-command';
const readerCommands = new Set<ReaderCommand>([
  'open-book',
  'toggle-bookmark',
  'show-contents',
  'toggle-reader-controls',
]);

const isReaderCommand = (value: unknown): value is ReaderCommand => (
  typeof value === 'string' && readerCommands.has(value as ReaderCommand)
);

contextBridge.exposeInMainWorld('yuguang', {
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
