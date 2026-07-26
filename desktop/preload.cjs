/**
 * Desktop bridge: the only surface the renderer gets beyond a plain browser.
 *
 * The web app's folder watching is handle-based polling (File System Access
 * API) because a browser can do no better. The desktop shell can: the main
 * process watches the folder natively (fs.watch) and pings the renderer the
 * moment something changes, so edits are picked up in ~a second instead of on
 * the next poll. The native watch is a TRIGGER only — scanning, diffing, and
 * ingestion still run through the exact same handle-based sync as the web
 * build, so behavior stays identical apart from latency.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  /** Absolute filesystem path for a File the renderer already holds ('' if unknown). */
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  /** Start (or move) the single native folder watch. Resolves false if unwatchable. */
  watchFolder(absolutePath) {
    return ipcRenderer.invoke('folder-watch:start', absolutePath);
  },
  unwatchFolder() {
    return ipcRenderer.invoke('folder-watch:stop');
  },
  /** Subscribe to change pings; returns an unsubscribe function. */
  onFolderChanged(callback) {
    const listener = () => callback();
    ipcRenderer.on('folder-watch:changed', listener);
    return () => ipcRenderer.removeListener('folder-watch:changed', listener);
  },
});
