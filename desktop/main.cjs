const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { createRequestHandler, hasIndexHtml } = require('../scripts/staticServer.cjs');

// Fixed port: the renderer's origin (http://127.0.0.1:<port>) is what
// Chromium partitions IndexedDB/localStorage by. A random port per launch
// would put every session's saved graph/settings behind a brand-new origin,
// making them invisible next time the app opens even though the data is
// still on disk. Keeping this port stable is what makes data persist across
// closing and reopening the app.
const LOCAL_SERVER_PORT = 47182;

let server;

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
      getResponseHeaders: (_target, ext) => ({
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
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
  if (server) {
    server.close();
  }
});