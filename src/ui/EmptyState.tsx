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
import { rememberCenterOrigin } from '../scene/ingestGesture';

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
          <div className="empty-state__hero">
            <Suspense fallback={<ConstellationSvg />}><HeroConstellation /></Suspense>
          </div>
          <div className="empty-state__visual-copy">
            <p className="empty-state__visual-kicker">See how your files relate</p>
            <p>
              Clips and documents become a map of what sounds alike, cites what, and shares a topic.
            </p>
          </div>
          <ul className="empty-state__trust-list" aria-label="Privacy and access">
            <li><span aria-hidden="true" />Everything runs in this browser. No account, no upload.</li>
          </ul>
        </aside>
        <div className="empty-state__content">
          <header className="empty-state__header">
            <Chip className="empty-state__eyebrow" size="sm" variant="secondary">
              <span className="empty-state__orb" aria-hidden="true" />
              Private workspace
            </Chip>
            <p className="empty-state__kicker">Resonance</p>
            <h1 className="empty-state__title">
              Find what sounds alike.
            </h1>
            <p className="empty-state__tagline">
              Drop in audio clips or documents and get a map of how they connect. Files stay on
              this device; nothing leaves it unless you turn on a cloud AI provider or share an export.
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

      </HeroEmptyState>
    </div>
  );
}
