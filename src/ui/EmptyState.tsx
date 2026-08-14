import { lazy, Suspense, useState } from 'react';
import { Button } from '@heroui/react/button';
import { Chip } from '@heroui/react/chip';
import { EmptyState as HeroEmptyState } from '@heroui/react/empty-state';
import { openFilePicker } from '../ingest/DropZone';
import { openFolderPicker } from '../ingest/folderPicker';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import ConstellationSvg from './ConstellationSvg';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './uiEvents';
import { rememberCenterOrigin } from '../scene/ingestBirth';

const CorpusSwitcher = lazy(() => import('./CorpusSwitcher'));
// Split out so the welcome screen paints without waiting on three.js; the flat
// mark stands in until the hero resolves.
const HeroConstellation = lazy(() => import('./HeroConstellation'));

/** The editorial, local-first welcome workspace shown before a corpus is loaded. */
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

  return (
    <div className="empty-state-layer">
      <HeroEmptyState className="empty-state__card glass-panel">
        <aside className="empty-state__visual" aria-label="Local-first knowledge mapping">
          <div className="empty-state__visual-label" aria-hidden="true">
            <span>Local observatory</span>
            <span>01 / 03</span>
          </div>
          <div className="empty-state__hero">
            <Suspense fallback={<ConstellationSvg />}><HeroConstellation /></Suspense>
          </div>
          <div className="empty-state__visual-copy">
            <p className="empty-state__visual-kicker">See the structure in your work</p>
            <p>
              Documents become a navigable constellation of topics, references, and shared ideas.
            </p>
          </div>
          <ul className="empty-state__trust-list" aria-label="Privacy and access">
            <li><span aria-hidden="true" />100% local processing</li>
            <li><span aria-hidden="true" />Private by design</li>
            <li><span aria-hidden="true" />No account required</li>
          </ul>
        </aside>
        <div className="empty-state__content">
          <header className="empty-state__header">
            <Chip className="empty-state__eyebrow" size="sm" variant="secondary">
              <span className="empty-state__orb" aria-hidden="true" />
              Private knowledge workspace
            </Chip>
            <p className="empty-state__kicker">Document Graph Explorer</p>
            <h1 className="empty-state__title">
              Turn scattered files into a living map.
            </h1>
            <p className="empty-state__tagline">
              Build an interactive 3D graph of ideas and relationships. Processing and storage stay
              in this browser, with files cached only on this device. Documents leave your device
              only when you explicitly enable a cloud AI provider or share exported graph data.
            </p>
          </header>

          <div className="empty-state__start">
            <p className="empty-state__section-label">Start a graph</p>
            <div className="empty-state__actions empty-state__actions--primary">
              <Button
                variant="primary"
                size="lg"
                className="empty-state__primary-action"
                data-ingest-add=""
                onPress={openFilePicker}
              >
                Add files
              </Button>
              <Button
                variant="secondary"
                size="lg"
                aria-label="Add a folder — every relevant file inside it is added, subfolders included"
                onPress={openFolderPicker}
              >
                Add a folder
              </Button>
            </div>
            <div className="empty-state__actions empty-state__actions--secondary">
              <Button
                variant="tertiary"
                size="md"
                isDisabled={demoLoading}
                onPress={loadDemo}
              >
                {demoLoading ? 'Loading demo…' : 'Load demo corpus'}
              </Button>
              <Button
                variant="tertiary"
                size="md"
                onPress={importGraph}
              >
                Import a graph
              </Button>
            </div>
            <p className="empty-state__hint">
              Drag files or folders anywhere, or choose a folder to include supported files from
              every subfolder.
            </p>
          </div>

          <div className="empty-state__workspace">
            <div>
              <p className="empty-state__section-label">Workspace</p>
              <p className="empty-state__workspace-copy">Open or manage a saved local corpus.</p>
            </div>
            <Suspense fallback={null}><CorpusSwitcher variant="empty" /></Suspense>
          </div>
        </div>

        <div className="empty-state__workflow" aria-label="How Document Graph Explorer works">
          <div className="empty-state__workflow-heading">
            <span>From files to map</span>
            <span>Three local steps</span>
          </div>
          <div className="empty-state__step">
            <span className="empty-state__step-number">01</span>
            <span><strong>Bring your files</strong>Docs, PDFs, Office, or a source repo.</span>
          </div>
          <div className="empty-state__step">
            <span className="empty-state__step-number">02</span>
            <span><strong>Find the signal</strong>Topics and connections emerge locally.</span>
          </div>
          <div className="empty-state__step">
            <span className="empty-state__step-number">03</span>
            <span><strong>Explore the map</strong>Navigate a living graph of your corpus.</span>
          </div>
        </div>
      </HeroEmptyState>
    </div>
  );
}
