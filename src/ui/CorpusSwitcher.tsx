import { useEffect, useRef, useState } from 'react';
import {
  chooseFolderToWatch,
  folderWatchingSupported,
  forgetFolderWatcher,
  pauseFolderWatcher,
  reconnectFolderWatcher,
  requestFolderSync,
} from '../ingest/folderWatcher';
import {
  createAndSwitchCorpus,
  deleteCorpusById,
  renameCorpusById,
  restoreCorpusById,
} from '../persistence/corpusActions';
import { useCorpusStore } from '../store/corpusStore';
import { useFolderWatchStore } from '../store/folderWatchStore';
import { useUiStore } from '../store/uiStore';

function clearPortableShareHash(): void {
  if (!window.location.hash.startsWith('#graph=')) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CorpusSwitcher({ variant = 'toolbar' }: { variant?: 'toolbar' | 'empty' }) {
  const activeId = useCorpusStore((state) => state.activeCorpusId);
  const activeName = useCorpusStore((state) => state.activeName);
  const mode = useCorpusStore((state) => state.mode);
  const corpora = useCorpusStore((state) => state.corpora);
  const switching = useCorpusStore((state) => state.switching);
  const watchStatus = useFolderWatchStore((state) => state.status);
  const folderName = useFolderWatchStore((state) => state.folderName);
  const lastChangeCount = useFolderWatchStore((state) => state.lastChangeCount);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      // Escape backs out one level at a time: an in-progress rename first,
      // then the menu itself. Closing the whole menu would discard the rename
      // and the user's place in it.
      if (renaming) setRenaming(false);
      else setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, renaming]);

  // Close when an overlay opens on top, the way Toolbar's menus do. The
  // capture-phase Escape above would otherwise consume the key meant for the
  // overlay the user is actually looking at.
  const overlayOpen = useUiStore(
    (s) => s.searchOpen || s.showMeOpen || s.settingsOpen || s.snapshotsOpen || s.helpOpen,
  );
  useEffect(() => {
    if (overlayOpen) setOpen(false);
  }, [overlayOpen]);

  const run = async (action: () => Promise<unknown>, closeAfter = false) => {
    setBusy(true);
    try {
      await action();
      if (closeAfter) setOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        useUiStore.getState().pushToast(message(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim() || `Corpus ${corpora.length + 1}`;
    await createAndSwitchCorpus(name);
    clearPortableShareHash();
    setNewName('');
  };

  const watchLabel = (() => {
    if (watchStatus === 'checking') return `Checking ${folderName ?? 'folder'}…`;
    if (watchStatus === 'watching') return `Watching ${folderName ?? 'folder'}`;
    if (watchStatus === 'paused') return `Paused · ${folderName ?? 'folder'}`;
    if (watchStatus === 'reconnect') return `Reconnect ${folderName ?? 'folder'}`;
    if (watchStatus === 'error') return `Folder sync needs attention`;
    return null;
  })();

  return (
    <div
      ref={rootRef}
      className={`corpus-switcher corpus-switcher--${variant}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="corpus-switcher__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Current corpus: ${activeName}${watchLabel ? `, ${watchLabel}` : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={`corpus-switcher__status is-${watchStatus}`}
          aria-hidden="true"
        />
        <span className="corpus-switcher__name">{activeName}</span>
        <span className="corpus-switcher__chevron" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div className="corpus-switcher__menu glass-panel" role="dialog" aria-label="Manage corpora">
          <div className="corpus-switcher__header">
            <div>
              <strong>Corpora</strong>
              <span>{mode === 'local' ? 'Stored on this device' : 'Portable view'}</span>
            </div>
            {watchLabel && <span className="corpus-switcher__watch-label" role="status">{watchLabel}</span>}
          </div>

          {/*
            A list, not a listbox: each row holds two independent controls
            (switch and delete), and role="option" may not contain interactive
            descendants. There is no aria-activedescendant model here either —
            the buttons are reached with Tab — so listbox was misreporting the
            widget to assistive tech.
          */}
          <div className="corpus-switcher__list" role="list" aria-label="Saved corpora">
            {corpora.map((corpus) => (
              <div className="corpus-switcher__row" role="listitem" key={corpus.id}>
                <button
                  type="button"
                  className="corpus-switcher__corpus"
                  aria-current={corpus.id === activeId ? 'true' : undefined}
                  disabled={busy || switching || corpus.id === activeId}
                  onClick={() => {
                    void run(async () => {
                      await restoreCorpusById(corpus.id);
                      clearPortableShareHash();
                    }, true);
                  }}
                >
                  <span>{corpus.name}</span>
                  <small>{corpus.documentCount} docs</small>
                </button>
                <button
                  type="button"
                  className={`corpus-switcher__delete${confirmDeleteId === corpus.id ? ' is-confirming' : ''}`}
                  aria-label={confirmDeleteId === corpus.id ? `Confirm delete ${corpus.name}` : `Delete ${corpus.name}`}
                  disabled={busy || switching || mode !== 'local'}
                  onClick={() => {
                    if (confirmDeleteId !== corpus.id) {
                      setConfirmDeleteId(corpus.id);
                      return;
                    }
                    void run(async () => {
                      await deleteCorpusById(corpus.id);
                      setConfirmDeleteId(null);
                    });
                  }}
                >
                  {confirmDeleteId === corpus.id ? 'Confirm' : '×'}
                </button>
              </div>
            ))}
          </div>

          <div className="corpus-switcher__create">
            <input
              value={newName}
              maxLength={80}
              placeholder="New corpus name"
              aria-label="New corpus name"
              disabled={busy || switching}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void run(create, true);
              }}
            />
            <button type="button" disabled={busy || switching} onClick={() => void run(create, true)}>
              New
            </button>
          </div>

          {activeId && (
            <div className="corpus-switcher__section">
              {renaming ? (
                <div className="corpus-switcher__create">
                  <input
                    autoFocus
                    value={renameValue}
                    maxLength={80}
                    aria-label="Rename current corpus"
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void run(async () => {
                          await renameCorpusById(activeId, renameValue);
                          setRenaming(false);
                        });
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void run(async () => {
                      await renameCorpusById(activeId, renameValue);
                      setRenaming(false);
                    })}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="corpus-switcher__action"
                  onClick={() => {
                    setRenameValue(activeName);
                    setRenaming(true);
                  }}
                >
                  Rename current corpus
                </button>
              )}
            </div>
          )}

          <div className="corpus-switcher__section">
            {watchStatus === 'idle' && folderWatchingSupported() && activeId && (
              <button type="button" className="corpus-switcher__action" disabled={busy} onClick={() => void run(chooseFolderToWatch)}>
                Watch a folder
              </button>
            )}
            {(watchStatus === 'reconnect' || watchStatus === 'paused') && (
              <button type="button" className="corpus-switcher__action" disabled={busy} onClick={() => void run(reconnectFolderWatcher)}>
                Reconnect folder
              </button>
            )}
            {(watchStatus === 'watching' || watchStatus === 'checking' || watchStatus === 'error') && (
              <button type="button" className="corpus-switcher__action" disabled={busy} onClick={() => void run(requestFolderSync)}>
                Rescan now{lastChangeCount > 0 ? ` · ${lastChangeCount} last time` : ''}
              </button>
            )}
            {(watchStatus === 'watching' || watchStatus === 'checking') && (
              <button type="button" className="corpus-switcher__action" disabled={busy} onClick={() => void run(pauseFolderWatcher)}>
                Pause watching
              </button>
            )}
            {folderName && (
              <button type="button" className="corpus-switcher__action is-danger" disabled={busy} onClick={() => void run(forgetFolderWatcher)}>
                Disconnect folder
              </button>
            )}
            {!folderWatchingSupported() && (
              <p className="corpus-switcher__unsupported">
                Live folder watching is unavailable here. Drag a folder into the app for a one-time import.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
