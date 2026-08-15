/**
 * Saved-views section of the toolbar's View menu. Lazy-loaded (like
 * ExportImportMenu): it drags the persistence layer along, which must stay
 * out of the eager entry chunk.
 */

import { useEffect, useState } from 'react';
import type { SavedViewRecord } from '../persistence/db';
import { useUiStore } from '../store/uiStore';
import {
  applySavedView,
  deleteSavedView,
  listSavedViews,
  nextViewName,
  saveCurrentView,
} from './savedViews';

import { IconBookmark } from './icons';

export default function SavedViewsSection({ onApplied }: { onApplied: () => void }) {
  // Loaded fresh on every mount — the menu unmounts when closed, so a corpus
  // switch while it was closed can never show the old corpus's bookmarks.
  const [views, setViews] = useState<SavedViewRecord[]>([]);
  useEffect(() => {
    void listSavedViews().then(setViews);
  }, []);

  return (
    <>
      <div
        role="separator"
        style={{ borderTop: '1px solid rgba(255,255,255,0.14)', margin: '4px 0' }}
      />
      <button
        type="button"
        className="toolbar__menu-item"
        title="Bookmark the current camera position, 2D/3D mode, and filters"
        onClick={() => {
          void (async () => {
            const view = await saveCurrentView(nextViewName(views));
            if (view) setViews((cur) => [view, ...cur]);
            else useUiStore.getState().pushToast("Couldn't save the view.");
          })();
        }}
      >
        <IconBookmark />
        <span>Save current view</span>
      </button>
      {views.map((view) => (
        <div key={view.id} style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            className="toolbar__menu-item"
            style={{ flex: 1 }}
            title={`Go to saved view "${view.name}"`}
            onClick={() => {
              applySavedView(view);
              onApplied();
            }}
          >
            <IconBookmark />
            <span>{view.name}</span>
          </button>
          <button
            type="button"
            className="toolbar__menu-item"
            style={{ flex: 'none', padding: '4px 8px', opacity: 0.7 }}
            title={`Delete saved view "${view.name}"`}
            aria-label={`Delete saved view ${view.name}`}
            onClick={() => {
              void deleteSavedView(view.id);
              setViews((cur) => cur.filter((v) => v.id !== view.id));
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}
