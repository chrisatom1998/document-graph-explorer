/**
 * Live PDF page preview for the SidePanel document reader: renders each page
 * of the ORIGINAL PDF as a canvas image via pdf.js, so the reader shows the
 * actual document rather than just its extracted text. Pages render lazily
 * as they scroll near the viewport (IntersectionObserver) — a document can
 * have hundreds of pages, and eagerly rasterizing all of them would be slow
 * and memory-heavy for no benefit over what's on screen. Symmetrically, a
 * page's canvas is cleared (and dropped from renderedRef, so it re-renders
 * on the way back) once it scrolls back OUT of that window, bounding memory
 * to roughly what's near the viewport rather than every page ever visited.
 *
 * MAIN-THREAD ONLY, same as pipeline/parsers/pdf.ts (pdf.js needs DOM/canvas).
 */

import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { ensurePdfWorkerReady } from '../pipeline/parsers/pdf';

// Canvas pixel resolution multiplier — rendered at a higher-than-CSS-size
// resolution so it stays crisp; the canvas is then scaled down to 100% width
// via CSS.
const RENDER_SCALE = 1.5;

interface PdfPreviewProps {
  blob: Blob;
  className?: string;
}

interface PageEntry {
  pageNo: number;
  width: number;
  height: number;
}

export default function PdfPreview({ blob, className }: PdfPreviewProps) {
  const [pages, setPages] = useState<PageEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderedRef = useRef<Set<number>>(new Set());

  // Load the document and collect per-page dimensions whenever the blob
  // (i.e. the selected document) changes.
  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setError(null);
    renderedRef.current = new Set();
    canvasRefs.current = new Map();

    void (async () => {
      try {
        await ensurePdfWorkerReady();
        const buf = await blob.arrayBuffer();
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        docRef.current = doc;
        const entries: PageEntry[] = [];
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          entries.push({ pageNo: i, width: viewport.width, height: viewport.height });
          page.cleanup();
        }
        if (!cancelled) setPages(entries);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load PDF preview');
        }
      }
    })();

    return () => {
      cancelled = true;
      docRef.current = null;
      const task = taskRef.current;
      taskRef.current = null;
      if (task) void task.destroy();
    };
  }, [blob]);

  // Rasterize one page into its canvas — idempotent, safe to call more than
  // once for the same page (renderedRef guards it).
  const renderPage = async (pageNo: number) => {
    const doc = docRef.current;
    const canvas = canvasRefs.current.get(pageNo);
    if (!doc || !canvas || renderedRef.current.has(pageNo)) return;
    renderedRef.current.add(pageNo);
    try {
      const page = await doc.getPage(pageNo);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
    } catch (err) {
      console.error('[PdfPreview] renderPage failed', pageNo, err);
      renderedRef.current.delete(pageNo); // allow a retry on next intersection
    }
  };

  // Observe every page's canvas and render it once it's within (or near) the
  // visible scroll area of the reader panel.
  useEffect(() => {
    if (!pages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNo = Number((entry.target as HTMLElement).dataset.pageNo);
          if (!pageNo) continue;
          if (entry.isIntersecting) {
            void renderPage(pageNo);
            continue;
          }
          // Left the observed window (scrolled far away) — clear the
          // rasterized bitmap and forget it was rendered so the browser can
          // reclaim the backing memory; it'll re-render on the way back.
          if (!renderedRef.current.has(pageNo)) continue;
          renderedRef.current.delete(pageNo);
          const canvas = canvasRefs.current.get(pageNo);
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      },
      { rootMargin: '400px 0px' },
    );
    for (const el of canvasRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  const wrapClass = className ? `pdf-preview ${className}` : 'pdf-preview';

  if (error) {
    return <div className={`${wrapClass} is-error`}>Preview unavailable — {error}</div>;
  }
  if (!pages) {
    return <div className={`${wrapClass} is-loading`}>Loading preview…</div>;
  }

  return (
    <div className={wrapClass}>
      {pages.map(({ pageNo, width, height }) => (
        <div key={pageNo} className="pdf-preview__page">
          <canvas
            data-page-no={pageNo}
            ref={(el) => {
              if (el) canvasRefs.current.set(pageNo, el);
              else canvasRefs.current.delete(pageNo);
            }}
            style={{ aspectRatio: `${width} / ${height}` }}
          />
          <span className="pdf-preview__page-num">{pageNo}</span>
        </div>
      ))}
    </div>
  );
}
