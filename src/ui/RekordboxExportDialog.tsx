import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { DocNode } from '../model/types';
import { dateStamp, downloadBlob } from '../persistence/exportImport';
import { buildRekordboxXml, folderPathMatchesRoot, rekordboxRootName } from '../persistence/rekordboxExport';
import { useUiStore } from '../store/uiStore';
import { useFocusTrap } from './useFocusTrap';

const STORAGE_KEY = 'dge.rekordboxFolders';

function savedFolders(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function saveFolders(folders: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...savedFolders(), ...folders }));
  } catch {
    // Remembering the folder is a convenience only.
  }
}

const panelStyle: CSSProperties = { width: 'min(480px, 92vw)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 };
const textStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55, opacity: 0.78 };
const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 4 };

export default function RekordboxExportDialog({ nodes, onClose }: { nodes: DocNode[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  const audioNodes = useMemo(() => nodes.filter(n => n.kind === 'document' && n.fileType === 'audio'), [nodes]);
  const roots = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of audioNodes) counts.set(rekordboxRootName(node), (counts.get(rekordboxRootName(node)) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [audioNodes]);
  const [folders, setFolders] = useState<Record<string, string>>(() => {
    const saved = savedFolders();
    return Object.fromEntries(roots.map(([root]) => [root, saved[root] ?? '']));
  });
  const ready = roots.filter(([root]) => folderPathMatchesRoot(folders[root] ?? '', root));

  const exportXml = () => {
    const usable = Object.fromEntries(ready.map(([root]) => [root, folders[root]]));
    saveFolders(usable);
    const { xml, tracks, skipped } = buildRekordboxXml(audioNodes, { folderPaths: usable, productVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined });
    downloadBlob(new Blob([xml], { type: 'application/xml' }), `rekordbox-${dateStamp()}.xml`);
    useUiStore.getState().pushToast(
      `Rekordbox XML exported with ${tracks} track${tracks === 1 ? '' : 's'}${skipped ? `; ${skipped} left out without a folder location` : ''}.`,
      'info',
    );
    onClose();
  };

  return createPortal(
    <div className="settings-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Export for Rekordbox"
        style={panelStyle}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      >
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Export for Rekordbox</h2>
        <p style={textStyle}>
          Writes each track's BPM, key and sound tags to a Rekordbox collection XML. The Camelot key and tags go in
          Comments. Beat grids are left to Rekordbox, since this app doesn't find the first downbeat.
        </p>
        <p style={textStyle}>
          The browser only sees folder names, so paste where each folder is on your computer. Rekordbox finds the
          files by that full path.
        </p>
        {roots.map(([root, count]) => {
          const value = folders[root] ?? '';
          const invalid = value.trim() !== '' && !folderPathMatchesRoot(value, root);
          const label = root ? `Full path of the folder “${root}”` : 'Folder holding the files you added on their own';
          return (
            <label key={root} style={{ fontSize: 13 }}>
              {label} ({count} track{count === 1 ? '' : 's'})
              <input
                type="text"
                style={inputStyle}
                spellCheck={false}
                placeholder={root ? `/Users/you/Music/${root}` : '/Users/you/Music'}
                value={value}
                aria-invalid={invalid}
                onChange={e => setFolders(prev => ({ ...prev, [root]: e.target.value }))}
              />
              {invalid && <span style={{ display: 'block', color: 'var(--danger, #e66)', marginTop: 2 }}>
                {root ? `Use the full path, ending in /${root}.` : 'Use the full path, starting with / or a drive letter.'}
              </span>}
            </label>
          );
        })}
        <p style={textStyle}>
          In Rekordbox, open Preferences › Advanced › Database, set “rekordbox xml” to this file, then find the
          playlist under “rekordbox xml” in the tree. Serato has no file to import BPM and key from: it reads
          them from tags inside the audio files, which a browser can't rewrite, so Serato will analyse the files itself.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="snapshot-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="snapshot-btn snapshot-btn--load" disabled={ready.length === 0} onClick={exportXml}>
            Export XML
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
