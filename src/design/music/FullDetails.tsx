import { lazy, Suspense } from 'react';

const SidePanel = lazy(() => import('../../ui/SidePanel'));

/** The shipped detail panel (reader, tags, notes, sound analysis), framed by the active design. */
export default function FullDetails({ onClose }: { onClose: () => void }) {
  return (
    <div className="rs-details mx-details">
      <Suspense fallback={<p className="mx-muted">Loading details…</p>}><SidePanel inline onClose={onClose} /></Suspense>
    </div>
  );
}
