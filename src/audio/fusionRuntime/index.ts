import type { NativeFusionArtifacts, NativeFusionSourceBinding } from './nativeBridge.mjs';
export type { NativeFusionArtifacts, NativeFusionSourceBinding } from './nativeBridge.mjs';
/** No implicit fetch, model selection or activation. Uses the import-adapted reviewed
 * factory. Its actual combined source/build hashes require separate qualification;
 * adapterSourceBytes remain the original semantic source referenced by the policy. */
export async function createCandidateFusionScorer(artifacts: NativeFusionArtifacts, sources: NativeFusionSourceBinding) {
  const { createNativeFusionScorer } = await import('./nativeBridge.mjs');
  return createNativeFusionScorer(artifacts, sources);
}
