import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type { ReaderCommand } from './global';

const READER_COMMAND_CHANNEL = 'reader-command';

if (started) {
  app.quit();
}

app.enableSandbox();

const sendReaderCommand = (command: ReaderCommand) => {
  const target = BrowserWindow.getFocusedWindow();
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }

  target.webContents.send(READER_COMMAND_CHANNEL, command);
};

const installApplicationMenu = () => {
  if (process.platform !== 'darwin') {
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: '文件',
      submenu: [
        {
          label: '打开书籍…',
          accelerator: 'Command+O',
          click: () => sendReaderCommand('open-book'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '阅读',
      submenu: [
        {
          label: '添加或移除书签',
          accelerator: 'Command+D',
          click: () => sendReaderCommand('toggle-bookmark'),
        },
        {
          label: '显示目录',
          accelerator: 'Command+T',
          click: () => sendReaderCommand('show-contents'),
        },
        { type: 'separator' },
        {
          label: '显示或隐藏阅读控件',
          accelerator: 'Command+Shift+C',
          click: () => sendReaderCommand('toggle-reader-controls'),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: '余光',
    backgroundColor: '#f4f1e9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.whenReady().then(() => {
  installApplicationMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
