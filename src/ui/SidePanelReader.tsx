import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { DocNode } from '../model/types';
import type { CodeLanguage } from '../pipeline/codeLanguage';
import { decodeText } from '../pipeline/parsers/txt';
import { getOriginal } from '../persistence/originals';
import { buildLinkIndex } from '../graph/linkResolver';
import { textStore } from '../store/runtimeStores';
import type { ReaderHighlight } from '../store/uiStore';
import { MAX_RENDER_CHARS } from './readerUtils';
import CsvPreview from './CsvPreview';
import DocumentMarkdown from './DocumentMarkdown';
import HtmlPreview from './HtmlPreview';
import JsonPreview, { MAX_RENDER_CHARS as JSON_MAX_RENDER_CHARS } from './JsonPreview';
import YamlPreview, { MAX_RENDER_CHARS as YAML_MAX_RENDER_CHARS } from './YamlPreview';
import PassageTarget from './PassageTarget';
import VirtualText from './VirtualText';
import { focusNode } from './focusNode';

function isMonoFileType(fileType: DocNode['fileType']): boolean {
  return fileType === 'txt' || fileType === 'other' || fileType === 'code';
}

// Lazy: pulls in pdfjs-dist, which needs DOM globals (DOMMatrix) absent in
// the jsdom test environment — only evaluate it when a PDF preview actually
// renders, mirroring the coordinator.ts mock seam used by SidePanel tests.
const PdfPreview = lazy(() => import('./PdfPreview'));

interface SidePanelReaderProps {
  node: DocNode;
  nodes: DocNode[];
  readerHighlight: ReaderHighlight | null;
  readerLabel: string;
  codeLang: CodeLanguage | null;
  onNavigate?: (id: string) => void;
}

export default function SidePanelReader({
  node,
  nodes,
  readerHighlight,
  readerLabel,
  codeLang,
  onNavigate = focusNode,
}: SidePanelReaderProps) {
  const fullText = textStore.get(node.id);
  const passageNeedle =
    readerHighlight?.docId === node.id ? readerHighlight.text : undefined;

  // Resolves a markdown link / [[wikilink]] target to a doc already in the
  // graph, so DocumentMarkdown can turn it into an in-app jump.
  const linkIndex = useMemo(() => buildLinkIndex(nodes), [nodes]);

  // Rendered markdown/HTML previews need the RAW source (link/heading/tag
  // syntax intact) — the pipeline's extracted text has already stripped it.
  // Fetch the retained original bytes lazily per selection; falls back to
  // the plain-text reader below when no original was kept (imported graphs,
  // legacy cache, oversized files) or the doc is too large to walk.
  const [mdSource, setMdSource] = useState<{ id: string; text: string } | null>(null);
  const [htmlSource, setHtmlSource] = useState<{ id: string; text: string } | null>(null);
  const mdDocId = node.kind === 'document' && node.fileType === 'md' ? node.id : null;
  const htmlDocId = node.kind === 'document' && node.fileType === 'html' ? node.id : null;
  useEffect(() => {
    setMdSource(null);
    setHtmlSource(null);
    const targetId = mdDocId ?? htmlDocId;
    if (!targetId) return;
    let cancelled = false;
    void (async () => {
      const original = await getOriginal(targetId);
      if (cancelled || !original) return;
      try {
        const buf = await original.blob.arrayBuffer();
        const raw = decodeText(buf);
        if (cancelled) return;
        if (mdDocId && raw.length <= MAX_RENDER_CHARS) {
          setMdSource({ id: mdDocId, text: raw });
        } else if (htmlDocId && raw.length <= MAX_RENDER_CHARS) {
          setHtmlSource({ id: htmlDocId, text: raw });
        }
      } catch {
        // decode failure — falls back to the extracted-text reader below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mdDocId, htmlDocId]);

  // Live PDF preview: renders each page of the original PDF as a canvas
  // image (see ui/PdfPreview.tsx) instead of just its extracted text — also
  // needs the retained original bytes, kept as a Blob rather than decoded.
  const [pdfPreview, setPdfPreview] = useState<{ id: string; blob: Blob } | null>(null);
  const pdfDocId = node.kind === 'document' && node.fileType === 'pdf' ? node.id : null;
  useEffect(() => {
    setPdfPreview(null);
    if (!pdfDocId) return;
    let cancelled = false;
    void (async () => {
      const original = await getOriginal(pdfDocId);
      if (!cancelled && original) {
        setPdfPreview({ id: pdfDocId, blob: original.blob });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDocId]);

  const passageKey = `${node.id}:${mdSource?.text.length ?? htmlSource?.text.length ?? fullText?.length ?? 0}`;

  return (
    <div className="side-panel__section side-panel__section--reader">
      <p className="side-panel__section-label">{readerLabel}</p>
      {readerHighlight?.docId === node.id && (
        <p className="side-panel__passage-banner" role="status">
          Matching passage
          {readerHighlight.passageIndex !== undefined
            ? ` · ${readerHighlight.passageIndex + 1}`
            : ''}
          {': '}
          <span className="side-panel__passage-banner-text">
            {readerHighlight.text.replace(/\s+/g, ' ').trim().slice(0, 220)}
          </span>
        </p>
      )}
      <div className={`side-panel__reader-frame${codeLang ? ' is-code' : ''}`}>
        {codeLang && (
          <span className="side-panel__reader-lang" title={codeLang.label}>
            {codeLang.short}
          </span>
        )}
        {pdfPreview && pdfPreview.id === node.id ? (
          <Suspense fallback={<div className="side-panel__reader is-unavailable">Loading preview…</div>}>
            <PdfPreview
              key={node.id}
              blob={pdfPreview.blob}
              className="side-panel__reader side-panel__reader--pdf"
            />
          </Suspense>
        ) : mdSource && mdSource.id === node.id ? (
          <PassageTarget needle={passageNeedle} contentKey={passageKey}>
            <DocumentMarkdown
              key={node.id}
              text={mdSource.text}
              linkIndex={linkIndex}
              onNavigate={onNavigate}
              className="side-panel__reader side-panel__reader--markdown"
              highlight={passageNeedle}
            />
          </PassageTarget>
        ) : htmlSource && htmlSource.id === node.id ? (
          <PassageTarget needle={passageNeedle} contentKey={passageKey}>
            <HtmlPreview
              key={node.id}
              html={htmlSource.text}
              className="side-panel__reader side-panel__reader--html"
              highlight={passageNeedle}
            />
          </PassageTarget>
        ) : node.fileType === 'csv' && fullText ? (
          <PassageTarget needle={passageNeedle} contentKey={passageKey}>
            <CsvPreview
              key={node.id}
              text={fullText}
              className="side-panel__reader side-panel__reader--csv"
            />
          </PassageTarget>
        ) : node.fileType === 'json' && fullText && fullText.length <= JSON_MAX_RENDER_CHARS ? (
          <PassageTarget needle={passageNeedle} contentKey={passageKey}>
            <JsonPreview
              key={node.id}
              text={fullText}
              className="side-panel__reader side-panel__reader--json"
              highlight={passageNeedle}
            />
          </PassageTarget>
        ) : node.fileType === 'json' && fullText ? (
          <JsonPreview
            key={node.id}
            text={fullText}
            className="side-panel__reader side-panel__reader--json"
            highlight={passageNeedle}
          />
        ) : node.fileType === 'yaml' && fullText && fullText.length <= YAML_MAX_RENDER_CHARS ? (
          <PassageTarget needle={passageNeedle} contentKey={passageKey}>
            <YamlPreview
              key={node.id}
              text={fullText}
              className="side-panel__reader side-panel__reader--yaml"
              highlight={passageNeedle}
            />
          </PassageTarget>
        ) : node.fileType === 'yaml' && fullText ? (
          <YamlPreview
            key={node.id}
            text={fullText}
            className="side-panel__reader side-panel__reader--yaml"
            highlight={passageNeedle}
          />
        ) : fullText ? (
          <VirtualText
            key={node.id}
            text={fullText}
            highlight={passageNeedle}
            className={`side-panel__reader${
              isMonoFileType(node.fileType) ? ' is-mono' : ''
            }`}
          />
        ) : node.summary ? (
          <div className="side-panel__reader">
            <p className="side-panel__summary">{node.summary}</p>
            <p className="side-panel__summary is-fallback">
              Full document text is not included in shared or imported graphs.
            </p>
          </div>
        ) : (
          <div className="side-panel__reader is-unavailable">
            text unavailable
          </div>
        )}
      </div>
    </div>
  );
}
