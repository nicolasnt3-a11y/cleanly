/**
 * Processus principal Electron (ESM). Fenêtre durcie : sandbox, contextIsolation,
 * aucun nodeIntegration, navigation bloquée, liens externes HTTPS uniquement.
 */
import { app, BrowserWindow, Menu, session, shell, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerIpc } from './ipc';

const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(here, '..', 'preload', 'preload.cjs');
const indexHtml = path.join(here, '..', 'renderer', 'index.html');
const devServerUrl = process.env.CLEANLY_DEV ? process.env.VITE_DEV_SERVER_URL : undefined;

app.enableSandbox();
nativeTheme.themeSource = 'light';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function openIfHttps(raw: string): void {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) void shell.openExternal(url.href);
  } catch {
    /* URL invalide : ignorée */
  }
}

// Durcissement global de chaque contenu web créé.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openIfHttps(url);
  });
  contents.on('will-redirect', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openIfHttps(url);
    return { action: 'deny' };
  });
});

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'Cleanly',
    backgroundColor: '#f5f6f8',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 20, y: 24 } }
      : { titleBarOverlay: { color: '#f5f6f8', symbolColor: '#0e0f12', height: 64 } }),
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  const trustedUrl = devServerUrl ?? pathToFileURL(indexHtml).href;
  registerIpc({ window: win, trustedUrl });

  win.once('ready-to-show', () => win.show());
  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(indexHtml);
  return win;
}

void app.whenReady().then(() => {
  // Aucune permission web (caméra, notifications, géolocalisation…).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  let win = createWindow();
  app.on('second-instance', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
