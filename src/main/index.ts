import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { closeDatabase, getDatabase } from './app-context';
import { registerIpcHandlers } from './ipc/register';
import { runSmokeMode } from './smoke';
import { AssistantManager } from './assistant/AssistantManager';

const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, '../preload/index.mjs');
const rendererIndex = join(__dirname, '../renderer/index.html');
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isSmoke = process.argv.includes('--smoke') || process.env.QUIZBANK_SMOKE === '1';
let assistantManager: AssistantManager | null = null;

const resolveWindowIcon = (): string | undefined => {
  if (!isDev || process.platform === 'darwin') {
    return undefined;
  }

  const iconPath = join(process.cwd(), 'build/icons/png/icon-512.png');
  return existsSync(iconPath) ? iconPath : undefined;
};

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 780,
    backgroundColor: '#f4f7fb',
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    await window.loadFile(rendererIndex);
  }

  return window;
};

app.whenReady().then(async () => {
  if (isSmoke) {
    await runSmokeMode();
    return;
  }

  const db = getDatabase();
  assistantManager = new AssistantManager(db, {
    preloadPath,
    rendererIndex,
    isDev,
    devServerUrl: process.env.VITE_DEV_SERVER_URL
  });
  registerIpcHandlers(db, assistantManager);
  await assistantManager.initialize();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (assistantManager?.isKeepingAlive()) {
    return;
  }

  if (process.platform !== 'darwin') {
    assistantManager?.dispose();
    closeDatabase();
    app.quit();
  }
});

app.on('before-quit', () => {
  assistantManager?.dispose();
  closeDatabase();
});
