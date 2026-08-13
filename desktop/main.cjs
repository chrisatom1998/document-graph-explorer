const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  SECURITY_HEADERS,
  createRequestHandler,
  hasIndexHtml,
} = require('../scripts/staticServer.cjs');

// Fixed port: the renderer's origin (http://127.0.0.1:<port>) is what
// Chromium partitions IndexedDB/localStorage by. A random port per launch
// would put every session's saved graph/settings behind a brand-new origin,
// making them invisible next time the app opens even though the data is
// still on disk. Keeping this port stable is what makes data persist across
// closing and reopening the app.
const LOCAL_SERVER_PORT = 47182;

let server;

// ---------------------------------------------------------------------------
// Native folder watching. One watch at a time (the renderer watches at most
// one folder per active corpus). Events are debounced and collapsed into a
// bare "something changed" ping — the renderer re-runs its normal
// File System Access scan to find out what, so the two code paths can never
// disagree about the folder's contents.
// ---------------------------------------------------------------------------
const FOLDER_CHANGE_DEBOUNCE_MS = 500;
let folderWatcher = null;
let folderChangeTimer = null;

function stopFolderWatch() {
  if (folderChangeTimer) clearTimeout(folderChangeTimer);
  folderChangeTimer = null;
  if (folderWatcher) folderWatcher.close();
  folderWatcher = null;
}

function registerFolderWatchIpc() {
  ipcMain.handle('folder-watch:start', (event, absolutePath) => {
    stopFolderWatch();
    if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) return false;
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      return false;
    }
    if (!stat.isDirectory()) return false;
    try {
      // recursive: supported natively on macOS and Windows. If the platform
      // refuses, the renderer's polling loop still covers the folder.
      folderWatcher = fs.watch(absolutePath, { recursive: true }, () => {
        if (folderChangeTimer) clearTimeout(folderChangeTimer);
        folderChangeTimer = setTimeout(() => {
          folderChangeTimer = null;
          if (!event.sender.isDestroyed()) event.sender.send('folder-watch:changed');
        }, FOLDER_CHANGE_DEBOUNCE_MS);
      });
      // A deleted/unmounted watch root errors rather than crashing the app;
      // the renderer's next poll reports the folder state as usual.
      folderWatcher.on('error', () => stopFolderWatch());
    } catch {
      folderWatcher = null;
      return false;
    }
    return true;
  });

  ipcMain.handle('folder-watch:stop', () => {
    stopFolderWatch();
    return true;
  });
}

function resolveDistPath() {
  return path.join(__dirname, '..', 'dist');
}

/** Only http(s) links may be handed off to the OS's default browser. */
function isAllowedExternalUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const distPath = resolveDistPath();

    if (!hasIndexHtml(distPath)) {
      reject(new Error(`Missing built app at ${distPath}. Run "npm run build" first.`));
      return;
    }

    const handleRequest = createRequestHandler(distPath, {
      spaFallback: true,
      headers: SECURITY_HEADERS,
      getResponseHeaders: (target, ext) => ({
        // Public filenames are not content-hashed. In particular, caching the
        // demo manifest as immutable made upgraded apps keep loading the old
        // corpus definition for a year.
        'Cache-Control':
          ext === '.html' ||
          ext === '.webmanifest' ||
          target.endsWith(path.join('demo', 'manifest.json'))
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
      }),
    });

    server = http.createServer(handleRequest);

    server.once('error', reject);
    server.listen(LOCAL_SERVER_PORT, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine local desktop server port.'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function createWindow() {
  const startUrl = await startStaticServer();
  const appOrigin = new URL(startUrl).origin;
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#07131f',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // The app never legitimately navigates away from its own local origin —
  // clicking/following a link should open externally (handled above), not
  // navigate the app window itself. Block anything else outright.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let navOrigin;
    try {
      navOrigin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (navOrigin !== appOrigin) {
      event.preventDefault();
    }
  });

  await mainWindow.loadURL(startUrl);
}

// Only one instance should ever bind LOCAL_SERVER_PORT. A second launch
// (e.g. double-clicking the app again) focuses the existing window instead
// of racing for the port or spawning a second server.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(() => {
    registerFolderWatchIpc();
    void createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  });
}

// Quit fully when the window closes, even on macOS — the app shouldn't
// linger in the Dock/menu bar after the user closes its only window.
app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  stopFolderWatch();
  if (server) {
    server.close();
  }
});
