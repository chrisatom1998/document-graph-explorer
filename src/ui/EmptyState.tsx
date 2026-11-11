import { lazy, Suspense, useRef, useState } from 'react';
import { AUDIO_DEMO_CLIPS } from '../demo/audioDemo';
import { openFilePicker } from '../ingest/DropZone';
import { openFolderPicker } from '../ingest/folderPicker';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './uiEvents';
import { rememberCenterOrigin } from '../scene/ingestGesture';
import heroPng960 from '../assets/hero/hero-lime-960.png';
import heroPng1920 from '../assets/hero/hero-lime-1920.png';
import heroWebp960 from '../assets/hero/hero-lime-960.webp';
import heroWebp1920 from '../assets/hero/hero-lime-1920.webp';

// Desktop: the art fills the card (up to 1080px wide). Phone: the img is 170% wide.
const HERO_SIZES = '(max-width: 820px) 170vw, min(1080px, 100vw)';

const CorpusSwitcher = lazy(() => import('./CorpusSwitcher'));

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
  // The document demo fetches its manifest before the pipeline phase changes
  // (which is what swaps this screen for the progress strip), so without a
  // busy state the button looks dead for seconds — and a second click would
  // queue another ingest. The audio demo is generated locally, but analysis
  // still takes long enough that both entries share one lock.
  const demoLock = useRef<'docs' | 'audio' | null>(null);
  const [demoLoading, setDemoLoading] = useState<'docs' | 'audio' | null>(null);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const loadDemo = (kind: 'docs' | 'audio') => {
    if (demoLock.current) return;
    demoLock.current = kind;
    setDemoLoading(kind);
    rememberCenterOrigin();
    import('../pipeline/coordinatorLazy')
      .then((mod) => (kind === 'docs' ? mod.loadDemoCorpus() : mod.loadDemoAudio()))
      .then(() => {
        // Only show the guide when the demo actually produced a graph; a
        // mid-run cancellation resolves the promise but leaves nodes empty.
        if (useGraphStore.getState().nodes.length > 0) {
          window.dispatchEvent(new Event(FIRST_RUN_GUIDE_REOPEN_EVENT));
        }
      })
      .catch((err) => {
        console.warn(kind === 'docs' ? 'demo corpus load failed' : 'audio demo load failed', err);
        useUiStore.getState().pushToast(
          kind === 'docs' ? "Couldn't load the demo corpus." : "Couldn't load the audio demo.",
        );
      })
      .finally(() => {
        demoLock.current = null;
        setDemoLoading(null);
      });
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
        <div className="empty-state__hero">
          <picture className="empty-state__art">
            <source
              type="image/webp"
              srcSet={`${heroWebp960} 960w, ${heroWebp1920} 1920w`}
              sizes={HERO_SIZES}
            />
            <img
              src={heroPng960}
              srcSet={`${heroPng960} 960w, ${heroPng1920} 1920w`}
              sizes={HERO_SIZES}
              alt=""
              width={1920}
              height={1080}
              decoding="async"
            />
          </picture>
          <div className="empty-state__hero-scrim" aria-hidden="true" />
        <div className="empty-state__content">
          <header className="empty-state__header">
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
                className="empty-state__primary-action"
                aria-describedby="empty-start-hint"
                aria-busy={demoLoading === 'docs'}
                disabled={demoLoading !== null}
                onClick={() => loadDemo('docs')}
              >
                {demoLoading === 'docs' ? 'Loading demo…' : 'Load demo corpus'}
              </button>
              <button
                type="button"
                className="empty-state__primary-action"
                aria-describedby="empty-start-hint"
                aria-busy={demoLoading === 'audio'}
                disabled={demoLoading !== null}
                onClick={() => loadDemo('audio')}
              >
                {demoLoading === 'audio' ? 'Loading audio demo…' : 'Load audio demo'}
              </button>
            </div>
            <div className="empty-state__links">
              <button
                type="button"
                className="empty-state__link"
                aria-describedby="empty-start-hint"
                onClick={openFolderPicker}
              >
                Add a folder
              </button>
              <button
                type="button"
                className="empty-state__link"
                onClick={importGraph}
              >
                Import a graph
              </button>
            </div>
            <p className="empty-state__hint" id="empty-start-hint">
              Drag files or folders here. A folder includes subfolders and follows
              .gitignore. Load demo corpus opens 100 sample documents. Load audio
              demo opens {AUDIO_DEMO_CLIPS.length} generated clips on this device.
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
        </div>

        <section className="empty-state__features" aria-labelledby="empty-features-title">
          <h2 className="empty-state__features-heading">
            <button
              type="button"
              className="empty-state__disclosure-summary"
              id="empty-features-title"
              aria-expanded={featuresOpen}
              aria-controls="empty-features-panel"
              onClick={() => setFeaturesOpen((open) => !open)}
            >
              In the workspace
            </button>
          </h2>
          {featuresOpen && (
            <div id="empty-features-panel">
              <p>
                These controls are in the top bar and sidebars once a graph is open.
                Add files, load a demo, or import a graph to reach them.
              </p>
              <ul className="empty-state__feature-list">
                {WORKSPACE_FEATURES.map((feature) => (
                  <li key={feature.title}>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
