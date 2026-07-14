/**
 * Lazy facade for persistence callers that need coordinator-owned mutations.
 *
 * The indirection preserves the existing async cycle break without marking the
 * statically-used coordinator module itself as a dynamic-import target.
 */
export {
  ingestFiles,
  loadDemoCorpus,
  rebuildEmbeddings,
  reconcileWatchedFiles,
  resetCorpus,
} from './coordinator';
