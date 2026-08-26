import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import type { ReaderCommand } from './global';

const APP_NAME = '阅';
const LEGACY_USER_DATA_DIRECTORY = '余光';
const READER_COMMAND_CHANNEL = 'reader-command';

// 保留旧数据目录，避免改名后丢失已导入书籍和阅读进度。
app.setPath(
  'userData',
  path.join(app.getPath('appData'), LEGACY_USER_DATA_DIRECTORY),
);
app.setName(APP_NAME);
app.enableSandbox();

const installDevelopmentDockIcon = () => {
  if (process.platform !== 'darwin' || !MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return;
  }

  app.dock?.setIcon(
    path.join(app.getAppPath(), 'src/assets/brand/yue-app-icon.png'),
  );
};

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
    title: '',
    backgroundColor: '#f4f1e9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // macOS 全屏会在顶部悬停时展开原生标题栏，保持其无标题。
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
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
  installDevelopmentDockIcon();
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
