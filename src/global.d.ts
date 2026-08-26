export type ReaderCommand =
  | 'open-book'
  | 'toggle-bookmark';

export interface YuguangApi {
  onReaderCommand: (
    listener: (command: ReaderCommand) => void,
  ) => () => void;
}

declare global {
  interface Window {
    yuguang: YuguangApi;
  }
}
