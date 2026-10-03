import type { FusionScorer } from '../fusion';
export interface NativeFusionArtifacts {
  modelBytes: Uint8Array; policyBytes: Uint8Array; adapterSourceBytes: Uint8Array;
  baselineRulesBytes: Uint8Array; promptsBytes: Uint8Array;
  expectedPolicyFileSha256: string; expectedAdapterSourceSha256: string;
}
export interface NativeFusionSourceBinding {
  bridgeSourceBytes: Uint8Array; expectedBridgeSourceSha256: string;
  scorerSourceBytes: Uint8Array; expectedScorerSourceSha256: string;
}
export function createNativeFusionScorer(artifacts: NativeFusionArtifacts, sources: NativeFusionSourceBinding): Promise<FusionScorer>;
