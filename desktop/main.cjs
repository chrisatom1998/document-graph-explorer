const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Fixed port: the renderer's origin (http://127.0.0.1:<port>) is what
// Chromium partitions IndexedDB/localStorage by. A random port per launch
// would put every session's saved graph/settings behind a brand-new origin,
// making them invisible next time the app opens even though the data is
// still on disk. Keeping this port stable is what makes data persist across
// closing and reopening the app.
const LOCAL_SERVER_PORT = 47182;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip',
};

let server;

function resolveDistPath() {
  return path.join(__dirname, '..', 'dist');
}

function resolveAssetPath(urlPathname) {
  const distPath = resolveDistPath();
  const requestPath = decodeURIComponent(urlPathname.split('?')[0]);
  const normalizedPath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const assetPath = path.join(distPath, normalizedPath === '/' ? 'index.html' : normalizedPath);
  const safeRoot = `${distPath}${path.sep}`;

  if (assetPath !== distPath && !assetPath.startsWith(safeRoot)) {
    return null;
  }

  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return assetPath;
  }

  const spaFallback = path.join(distPath, 'index.html');
  return fs.existsSync(spaFallback) ? spaFallback : null;
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const distPath = resolveDistPath();

    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      reject(new Error(`Missing built app at ${distPath}. Run "npm run build" first.`));
      return;
    }

    server = http.createServer((req, res) => {
      const assetPath = resolveAssetPath(req.url || '/');

      if (!assetPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const extension = path.extname(assetPath).toLowerCase();
      const contentType = MIME_TYPES[extension] || 'application/octet-stream';

      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Content-Type': contentType,
      });

      fs.createReadStream(assetPath).pipe(res);
    });

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
    void shell.openExternal(url);
    return { action: 'deny' };
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