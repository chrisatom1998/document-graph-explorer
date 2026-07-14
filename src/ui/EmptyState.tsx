import { lazy, Suspense } from 'react';
import { openFilePicker } from '../ingest/DropZone';
import { useUiStore } from '../store/uiStore';

const CorpusSwitcher = lazy(() => import('./CorpusSwitcher'));

/** The project overview displayed before a corpus is loaded. */
export default function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__card glass-panel">
        <div className="empty-state__eyebrow">
          <span className="empty-state__orb" aria-hidden="true" />
          Local-first document intelligence
        </div>
        <div className="empty-state__intro">
          <p className="empty-state__kicker">Meet your knowledge nebula</p>
          <h1 className="empty-state__title">See the shape of what you know.</h1>
          <p className="empty-state__tagline">
            Document Graph Explorer turns scattered files into an interactive 3D map of
            ideas, relationships, and themes—right in your browser.
          </p>
        </div>
        <div className="empty-state__actions">
          <button
            type="button"
            className="btn-pill"
            title="Choose files or folders to build your graph"
            onClick={openFilePicker}
          >
            Add files
          </button>
          <button
            type="button"
            className="btn-pill secondary"
            title="Load a sample documentation set to explore the tool"
            onClick={() => {
              import('../pipeline/coordinatorLazy').then(({ loadDemoCorpus }) => loadDemoCorpus()).catch((err) => {
                console.warn('demo corpus load failed', err);
                useUiStore.getState().pushToast("Couldn't load the demo corpus.");
              });
            }}
          >
            Load demo corpus
          </button>
          <button
            type="button"
            className="btn-pill secondary"
            title="Import a previously exported graph JSON file"
            onClick={() => {
              void import('./ExportImportMenu').then(({ importGraphJsonFileWithToast, openGraphJsonPicker }) => {
                openGraphJsonPicker((file) => {
                  void importGraphJsonFileWithToast(file);
                });
              }).catch((error) => {
                console.warn('graph import tools failed to load', error);
                useUiStore.getState().pushToast("Couldn't open the graph importer.");
              });
            }}
          >
            Import a graph
          </button>
        </div>
        <Suspense fallback={null}><CorpusSwitcher variant="empty" /></Suspense>
        <p className="empty-state__hint">or drag files and folders anywhere</p>
        <div className="empty-state__workflow" aria-label="How Document Graph Explorer works">
          <div className="empty-state__step">
            <span className="empty-state__step-number">01</span>
            <span><strong>Bring your files</strong>PDF, Office, Markdown, HTML, or text.</span>
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
        <div className="empty-state__trust-row">
          <span>100% local</span>
          <i aria-hidden="true" />
          <span>Your documents stay in this browser</span>
          <i aria-hidden="true" />
          <span>No account required</span>
        </div>
      </div>
    </div>
  );
}
