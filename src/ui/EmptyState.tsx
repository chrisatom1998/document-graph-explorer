import { lazy, Suspense, useState } from 'react';
import { openFilePicker } from '../ingest/DropZone';
import { openFolderPicker } from '../ingest/folderPicker';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import ConstellationSvg from './ConstellationSvg';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './uiEvents';
import { rememberCenterOrigin } from '../scene/ingestGesture';

const CorpusSwitcher = lazy(() => import('./CorpusSwitcher'));
// Split out so the welcome screen paints without waiting on three.js; the flat
// mark stands in until the hero resolves.
const HeroConstellation = lazy(() => import('./HeroConstellation'));

/**
 * Tools that exist in the workspace once a graph is open. Copy uses the
 * control names from the top bar, filters and More tools menu.
 */
const WORKSPACE_FEATURES = [
  {
    title: 'Graph and Library',
    body: '2D by default, 3D from the top bar. Library lists every file.',
  },
  {
    title: 'Sounds',
    body: 'Tempo, key and sound tags on this device. Sample assistant builds crates once audio is loaded.',
  },
  {
    title: 'Documents',
    body: 'Search (Ctrl or Cmd K), the reader, Compare, and Ask about your library.',
  },
  {
    title: 'Filters',
    body: 'Instruments, tempo, key, meaning, keywords, names and links, plus BPM and genre.',
  },
  {
    title: 'More tools',
    body: 'Insights, Find a path, Snapshots, Saved views, Collaborate, notes, tags and pins.',
  },
  {
    title: 'Export',
    body: 'PNG, graph JSON, a share link, OpenUSD, and Rekordbox XML when the library has audio.',
  },
] as const;

/** The local-first welcome workspace shown before a corpus is loaded. */
export default function EmptyState() {
  // The demo fetches its manifest and every sample file before the pipeline
  // phase changes (which is what swaps this screen for the progress strip),
  // so without a busy state the button looks dead for seconds on a slow
  // connection — and a second click would queue a second ingest.
  const [demoLoading, setDemoLoading] = useState(false);
  const loadDemo = () => {
    if (demoLoading) return;
    setDemoLoading(true);
    rememberCenterOrigin();
    import('../pipeline/coordinatorLazy')
      .then(({ loadDemoCorpus }) => loadDemoCorpus())
      .then(() => {
        // Only show the guide when the demo actually produced a graph; a
        // mid-run cancellation resolves the promise but leaves nodes empty.
        if (useGraphStore.getState().nodes.length > 0) {
          window.dispatchEvent(new Event(FIRST_RUN_GUIDE_REOPEN_EVENT));
        }
      })
      .catch((err) => {
        console.warn('demo corpus load failed', err);
        useUiStore.getState().pushToast("Couldn't load the demo corpus.");
      })
      .finally(() => setDemoLoading(false));
  };

  const importGraph = () => {
    void import('./ExportImportMenu').then(({ importGraphJsonFileWithToast, openGraphJsonPicker }) => {
      openGraphJsonPicker((file) => {
        void importGraphJsonFileWithToast(file);
      });
    }).catch((error) => {
      console.warn('graph import tools failed to load', error);
      useUiStore.getState().pushToast("Couldn't open the graph importer.");
    });
  };

  const openSettings = () => useUiStore.getState().setSettingsOpen(true);
  const openHelp = () => useUiStore.getState().setHelpOpen(true);

  return (
    // A labelled section keeps the card's headings from becoming a second
    // page banner and gives the welcome text a landmark.
    <section className="empty-state-layer" aria-label="Welcome">
      <div className="empty-state__card">
        <div className="empty-state__visual">
          <div className="empty-state__hero">
            <Suspense fallback={<ConstellationSvg />}><HeroConstellation /></Suspense>
          </div>
          <div className="empty-state__visual-copy">
            <p className="empty-state__visual-kicker">One map for both</p>
            <p>
              Clips connect by sound, tempo and key. Documents connect by topic,
              citation and meaning.
            </p>
          </div>
        </div>

        <div className="empty-state__content">
          <header className="empty-state__header">
            <p className="empty-state__kicker">Local-first</p>
            <h1 className="empty-state__title">See how sounds and documents relate.</h1>
            <p className="empty-state__tagline">
              Add clips, sample packs, notes, PDFs or a source folder. No account.
              Nothing is uploaded unless you turn on a cloud AI provider or share an export.
            </p>
          </header>

          <div className="empty-state__start">
            <h2 className="empty-state__section-label" id="empty-start-label">Start a graph</h2>
            <div className="empty-state__actions empty-state__actions--start" role="group" aria-labelledby="empty-start-label">
              <button
                type="button"
                className="empty-state__primary-action"
                data-ingest-add=""
                onClick={openFilePicker}
              >
                Add files
              </button>
              <button
                type="button"
                className="empty-state__secondary-action"
                aria-describedby="empty-start-hint"
                onClick={openFolderPicker}
              >
                Add a folder
              </button>
              <button
                type="button"
                className="empty-state__secondary-action"
                aria-describedby="empty-start-hint"
                aria-busy={demoLoading}
                disabled={demoLoading}
                onClick={loadDemo}
              >
                {demoLoading ? 'Loading demo…' : 'Load demo corpus'}
              </button>
              <button
                type="button"
                className="empty-state__secondary-action"
                onClick={importGraph}
              >
                Import a graph
              </button>
            </div>
            <p className="empty-state__hint" id="empty-start-hint">
              Drag files or folders here. A folder includes subfolders and follows
              .gitignore. Load demo corpus opens 100 sample documents, not audio.
            </p>
          </div>

          <div className="empty-state__workspace">
            <div>
              <h2 className="empty-state__section-label" id="empty-workspace-label">Saved workspace</h2>
              <p className="empty-state__workspace-copy" id="empty-workspace-hint">
                Open, rename or create a corpus in this browser, or watch a folder.
              </p>
            </div>
            <div className="empty-state__workspace-actions">
              <button
                type="button"
                className="empty-state__ghost"
                aria-haspopup="dialog"
                aria-describedby="empty-settings-hint"
                onClick={openSettings}
              >
                Settings
              </button>
              <button
                type="button"
                className="empty-state__ghost"
                aria-haspopup="dialog"
                aria-describedby="empty-help-hint"
                onClick={openHelp}
              >
                Help
              </button>
              <Suspense fallback={null}><CorpusSwitcher variant="empty" /></Suspense>
            </div>
            <p id="empty-settings-hint" className="sr-only">
              Music analysis, optional OpenRouter or local Ollama, and offline mode.
            </p>
            <p id="empty-help-hint" className="sr-only">
              Graph legend, how clips are linked, and keyboard shortcuts.
            </p>
          </div>
        </div>

        <section className="empty-state__features" aria-labelledby="empty-features-title">
          <div className="empty-state__features-head">
            <h2 className="empty-state__section-label" id="empty-features-title">In the workspace</h2>
            <p>
              These controls are in the top bar and sidebars once a graph is open.
              Add files, load the demo, or import a graph to reach them.
            </p>
          </div>
          <ul className="empty-state__feature-list">
            {WORKSPACE_FEATURES.map((feature) => (
              <li key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
