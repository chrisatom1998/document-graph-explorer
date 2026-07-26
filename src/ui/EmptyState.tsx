import { lazy, Suspense } from 'react';
import { Button } from '@heroui/react/button';
import { Chip } from '@heroui/react/chip';
import { EmptyState as HeroEmptyState } from '@heroui/react/empty-state';
import { openFilePicker } from '../ingest/DropZone';
import { useUiStore } from '../store/uiStore';

const CorpusSwitcher = lazy(() => import('./CorpusSwitcher'));

function Constellation() {
  return (
    <svg className="empty-state__constellation" viewBox="0 0 360 272" fill="none" aria-hidden="true">
      <circle className="empty-state__orbit empty-state__orbit--outer" cx="180" cy="136" r="114" />
      <ellipse className="empty-state__orbit" cx="180" cy="136" rx="74" ry="126" />
      <path className="empty-state__link" d="M75 178 130 90l64 56 75-94 31 132-105-38-120 32Z" />
      <circle className="empty-state__node empty-state__node--core" cx="194" cy="146" r="15" />
      <circle className="empty-state__node" cx="75" cy="178" r="5" />
      <circle className="empty-state__node" cx="130" cy="90" r="7" />
      <circle className="empty-state__node empty-state__node--cyan" cx="269" cy="52" r="5" />
      <circle className="empty-state__node" cx="300" cy="184" r="6" />
      <circle className="empty-state__node empty-state__node--cyan" cx="155" cy="214" r="4" />
    </svg>
  );
}

/** The editorial, local-first welcome workspace shown before a corpus is loaded. */
export default function EmptyState() {
  const loadDemo = () => {
    import('../pipeline/coordinatorLazy').then(({ loadDemoCorpus }) => loadDemoCorpus()).catch((err) => {
      console.warn('demo corpus load failed', err);
      useUiStore.getState().pushToast("Couldn't load the demo corpus.");
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

  return (
    <div className="empty-state-layer">
      <HeroEmptyState className="empty-state__card glass-panel">
        <div className="empty-state__visual"><Constellation /></div>
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
              Build a local interactive 3D graph of ideas and relationships, then explore the
              shape of your research without sending your documents anywhere.
            </p>
          </header>

          <div className="empty-state__actions">
            <Button
              variant="primary"
              size="lg"
              className="empty-state__primary-action"
              onPress={openFilePicker}
            >
              Add files
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onPress={loadDemo}
            >
              Load demo corpus
            </Button>
            <Button
              variant="tertiary"
              size="lg"
              onPress={importGraph}
            >
              Import a graph
            </Button>
          </div>
          <Suspense fallback={null}><CorpusSwitcher variant="empty" /></Suspense>
          <p className="empty-state__hint">or drag files and folders anywhere</p>
        </div>

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
          <span>100% local</span><i aria-hidden="true" />
          <span>Private by design</span><i aria-hidden="true" />
          <span>No account required</span>
        </div>
      </HeroEmptyState>
    </div>
  );
}
