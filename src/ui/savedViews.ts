/**
 * Saved views: named bookmarks of camera pose + display state (2D/3D, filter),
 * stored per corpus in IndexedDB. Saving captures the live cameraPose (written
 * every frame by CameraRig); applying restores dims and filter through the ui
 * store and glides the camera back via a 'pose' command.
 */

import { layoutSetDims } from '../layout/layoutBridge';
import { cameraPose } from '../scene/cameraPose';
import { getCorpusRecord, updateCorpusViews } from '../persistence/corpusRepository';
import type { SavedViewRecord } from '../persistence/db';
import { useCorpusStore } from '../store/corpusStore';
import { useUiStore } from '../store/uiStore';

const MAX_VIEWS_PER_CORPUS = 12;

function activeCorpusId(): string | null {
  return useCorpusStore.getState().activeCorpusId;
}

export async function listSavedViews(): Promise<SavedViewRecord[]> {
  const corpusId = activeCorpusId();
  if (!corpusId) return [];
  const record = await getCorpusRecord(corpusId);
  return record?.views ?? [];
}

/** Capture the current camera + display state as a new named view. */
export async function saveCurrentView(name: string): Promise<SavedViewRecord | null> {
  const corpusId = activeCorpusId();
  if (!corpusId) return null;
  const ui = useUiStore.getState();
  const view: SavedViewRecord = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled view',
    createdAt: Date.now(),
    pose: {
      px: cameraPose.px,
      py: cameraPose.py,
      pz: cameraPose.pz,
      tx: cameraPose.tx,
      ty: cameraPose.ty,
      tz: cameraPose.tz,
    },
    dims: ui.dims,
    filter: {
      fileTypes: ui.filter.fileTypes ? [...ui.filter.fileTypes] : null,
      clusters: ui.filter.clusters ? [...ui.filter.clusters] : null,
      minDegree: ui.filter.minDegree,
      minEdgeWeight: ui.filter.minEdgeWeight,
    },
  };
  const existing = (await getCorpusRecord(corpusId))?.views ?? [];
  const views = [view, ...existing].slice(0, MAX_VIEWS_PER_CORPUS);
  await updateCorpusViews(corpusId, views);
  return view;
}

/** Restore a view: dims and filter first, then glide the camera to the pose. */
export function applySavedView(view: SavedViewRecord): void {
  const ui = useUiStore.getState();
  if (ui.dims !== view.dims) {
    // Mirrors the toolbar's 2D/3D toggle: the store flag alone doesn't move
    // the layout worker between planar and volumetric simulation.
    ui.setDims(view.dims);
    layoutSetDims(view.dims);
  }
  ui.setFilter({
    fileTypes: view.filter.fileTypes,
    clusters: view.filter.clusters,
    minDegree: view.filter.minDegree,
    minEdgeWeight: view.filter.minEdgeWeight,
  });
  ui.sendCameraPose(view.pose);
}

export async function deleteSavedView(id: string): Promise<void> {
  const corpusId = activeCorpusId();
  if (!corpusId) return;
  const existing = (await getCorpusRecord(corpusId))?.views ?? [];
  await updateCorpusViews(corpusId, existing.filter((v) => v.id !== id));
}

/** Default name for the next saved view: "View 1", "View 2", … */
export function nextViewName(existing: SavedViewRecord[]): string {
  const used = new Set(existing.map((v) => v.name));
  for (let n = existing.length + 1; ; n++) {
    const name = `View ${n}`;
    if (!used.has(name)) return name;
  }
}
