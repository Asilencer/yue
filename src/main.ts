import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  DataMigrationMode,
  DataMigrationPayload,
  ReaderCommand,
} from './global';

const APP_NAME = '阅';
const READER_COMMAND_CHANNEL = 'reader-command';
const DATA_MIGRATION_MODE_CHANNEL = 'data-migration:mode';
const DATA_MIGRATION_SAVE_CHANNEL = 'data-migration:save';
const DATA_MIGRATION_READ_CHANNEL = 'data-migration:read';
const DATA_MIGRATION_COMPLETE_CHANNEL = 'data-migration:complete';
const DATA_MIGRATION_FAIL_CHANNEL = 'data-migration:fail';
const DATA_MIGRATION_IMPORT_ARGUMENT = '--import-data-migration';

const applicationDataPath = app.getPath('appData');
const currentUserDataPath = path.join(applicationDataPath, APP_NAME);
const legacyUserDataPath = path.join(applicationDataPath, '余光');
const dataMigrationFile = path.join(currentUserDataPath, 'migration-v1.json');
const dataMigrationMarker = path.join(currentUserDataPath, '.migration-v1-complete');
const hasPendingDataMigration = existsSync(legacyUserDataPath)
  && !existsSync(dataMigrationMarker);
const dataMigrationMode: DataMigrationMode = hasPendingDataMigration
  ? process.argv.includes(DATA_MIGRATION_IMPORT_ARGUMENT) ? 'import' : 'export'
  : 'none';

app.setName(APP_NAME);
app.setPath(
  'userData',
  dataMigrationMode === 'export' ? legacyUserDataPath : currentUserDataPath,
);
app.enableSandbox();

const scheduleRelaunch = (importData: boolean) => {
  const args = process.argv.slice(1).filter(
    (argument) => argument !== DATA_MIGRATION_IMPORT_ARGUMENT,
  );

  if (importData) {
    args.push(DATA_MIGRATION_IMPORT_ARGUMENT);
  }
  setTimeout(() => {
    app.relaunch({ args });
    app.exit(0);
  }, 50);
};

const nextMigrationBackupPath = () => {
  const basePath = path.join(applicationDataPath, `${APP_NAME}-迁移备份`);
  let candidate = basePath;
  let suffix = 2;

  while (existsSync(candidate)) {
    candidate = `${basePath}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

ipcMain.on(DATA_MIGRATION_MODE_CHANNEL, (event) => {
  event.returnValue = dataMigrationMode;
});
ipcMain.handle(
  DATA_MIGRATION_SAVE_CHANNEL,
  (_event, payload: DataMigrationPayload) => {
    if (dataMigrationMode !== 'export') {
      throw new Error('当前不处于数据导出阶段');
    }
    mkdirSync(currentUserDataPath, { recursive: true });
    const temporaryFile = `${dataMigrationFile}.tmp`;

    writeFileSync(temporaryFile, JSON.stringify(payload));
    renameSync(temporaryFile, dataMigrationFile);
    scheduleRelaunch(true);
  },
);
ipcMain.handle(DATA_MIGRATION_READ_CHANNEL, () => {
  if (dataMigrationMode !== 'import') {
    throw new Error('当前不处于数据导入阶段');
  }
  return JSON.parse(readFileSync(dataMigrationFile, 'utf8')) as DataMigrationPayload;
});
ipcMain.handle(DATA_MIGRATION_COMPLETE_CHANNEL, () => {
  if (dataMigrationMode !== 'import') {
    throw new Error('当前不处于数据导入阶段');
  }
  const backupPath = nextMigrationBackupPath();

  renameSync(legacyUserDataPath, backupPath);
  writeFileSync(dataMigrationMarker, backupPath);
  unlinkSync(dataMigrationFile);
  scheduleRelaunch(false);
});
ipcMain.handle(DATA_MIGRATION_FAIL_CHANNEL, (_event, message: string) => {
  dialog.showErrorBox('数据迁移失败', message);
  app.exit(1);
});

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
  mainWindow.once('ready-to-show', () => {
    if (dataMigrationMode === 'none') {
      mainWindow.show();
    }
  });
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
