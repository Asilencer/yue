export type ReaderCommand =
  | 'open-book'
  | 'toggle-bookmark';

export interface YueApi {
  onReaderCommand: (
    listener: (command: ReaderCommand) => void,
  ) => () => void;
}

declare global {
  interface Window {
    yue: YueApi;
  }
}
