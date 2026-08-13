/**
 * Product surface — what Document Graph Explorer *is*, vs. the extras it
 * accumulated. The default chrome should only expose CORE. Studio and
 * interop live one click deeper (menus). Packaging is not a product feature.
 *
 * Keep this file as the checklist when adding UI: a new first-class toolbar
 * button needs a CORE reason, not just a new capability.
 */

export type CapabilityLayer = 'core' | 'studio' | 'interop' | 'packaging';

/** How the capability shows up in the default shell. */
export type ChromePlacement =
  | 'always'
  | 'overlay'
  | 'menu'
  | 'settings'
  | 'settings-advanced'
  | 'hidden'
  | 'packaging';

export interface Capability {
  id: string;
  layer: CapabilityLayer;
  chrome: ChromePlacement;
  summary: string;
}

/**
 * The tool is one loop: drop files → see a graph → read a document → search.
 * Everything else is a satellite of that loop.
 */
export const CORE_LOOP = [
  'ingest',
  'graph',
  'read',
  'search',
  'persist',
] as const;

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'ingest',
    layer: 'core',
    chrome: 'always',
    summary: 'Drop files or pick a folder; parse, embed, and cluster locally.',
  },
  {
    id: 'graph',
    layer: 'core',
    chrome: 'always',
    summary: 'Force-directed 3D graph with 2D fallback when the GPU struggles.',
  },
  {
    id: 'read',
    layer: 'core',
    chrome: 'overlay',
    summary: 'Click a node to read the document and see why it is connected.',
  },
  {
    id: 'search',
    layer: 'core',
    chrome: 'overlay',
    summary: '⌘K lexical + semantic search; “Show all in graph” frames matches.',
  },
  {
    id: 'persist',
    layer: 'core',
    chrome: 'hidden',
    summary: 'IndexedDB restore so a corpus comes back without re-parsing.',
  },
  {
    id: 'filters',
    layer: 'core',
    chrome: 'overlay',
    summary: 'File type and cluster chips. Strength, kinds, and recency stay folded.',
  },
  {
    id: 'chat',
    layer: 'core',
    chrome: 'overlay',
    summary: 'Ask the corpus; local extractive answers by default.',
  },
  {
    id: 'path',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Fewest-hop route between two documents.',
  },
  {
    id: 'insights',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Orphans, duplicates, bridges, stale docs.',
  },
  {
    id: 'snapshots',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Named graph states and visual compare.',
  },
  {
    id: 'saved-views',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Camera + filter bookmarks inside View options.',
  },
  {
    id: 'topic-nodes',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Optional topic hubs; off until the user asks.',
  },
  {
    id: 'cluster-collapse',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Super-node view for large graphs.',
  },
  {
    id: 'export-json',
    layer: 'interop',
    chrome: 'menu',
    summary: 'Portable graph JSON — the interchange format that matters.',
  },
  {
    id: 'export-png',
    layer: 'interop',
    chrome: 'menu',
    summary: 'Scene snapshot for slides and tickets.',
  },
  {
    id: 'share-url',
    layer: 'interop',
    chrome: 'menu',
    summary: 'Sanitized URL fragment; not a collaboration product.',
  },
  {
    id: 'export-usd',
    layer: 'interop',
    chrome: 'menu',
    summary: 'OpenUSD stage for usdview / Omniverse — keep, do not promote.',
  },
  {
    id: 'ocr',
    layer: 'studio',
    chrome: 'settings-advanced',
    summary: 'Scanned-PDF fallback; original spec treated this as a non-goal.',
  },
  {
    id: 'enrichment',
    layer: 'studio',
    chrome: 'settings',
    summary: 'Optional OpenRouter / Ollama summaries; off by default.',
  },
  {
    id: 'multi-corpus',
    layer: 'studio',
    chrome: 'always',
    summary: 'Named workspaces in the corpus switcher — one control, not a page.',
  },
  {
    id: 'folder-watch',
    layer: 'studio',
    chrome: 'menu',
    summary: 'Live folder sync from the corpus switcher, not the toolbar.',
  },
  {
    id: 'airgap',
    layer: 'packaging',
    chrome: 'packaging',
    summary: 'Sealed zero-egress build — a distribution mode, not a second app.',
  },
  {
    id: 'desktop',
    layer: 'packaging',
    chrome: 'packaging',
    summary: 'Electron / AppImage / shortcut launchers wrap the same web app.',
  },
  {
    id: 'usd-agent',
    layer: 'packaging',
    chrome: 'packaging',
    summary: 'Python CLI over an exported stage; lives in tools/, not the SPA.',
  },
] as const;

export const DEFAULT_TOOLBAR_ACTIONS = [
  'search',
  'fit',
  'view',
  'analyze',
  'data',
  'settings',
  'add',
] as const;

export const ANALYZE_MENU_ACTIONS = ['path', 'insights', 'snapshots'] as const;

export function capabilitiesOnLayer(layer: CapabilityLayer): Capability[] {
  return CAPABILITIES.filter((capability) => capability.layer === layer);
}

export function firstClassToolbarIds(): readonly string[] {
  return DEFAULT_TOOLBAR_ACTIONS;
}
