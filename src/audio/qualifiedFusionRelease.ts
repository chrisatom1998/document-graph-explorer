import type { FusionRelease } from './fusionRelease';
import { musicRuntimeIdentity } from './musicRuntime';
import { createCandidateFusionScorer } from './fusionRuntime';
/** Fixed source-owned release accepted on the sealed 256 public OpenMIC cohort. */
export const QUALIFIED_FUSION_RELEASE: FusionRelease = {
  identity: {
  "modelSha256": "d43b2e9285cef986fc9fbd2c12400f839dce120d207b42e7bdd7c9ce0880be7b",
  "policySha256": "dbf0fdf070e66b5461fda86664d93e91652ddf63743dd3d8456b3925bc5fd755",
  "scorerSha256": "f24b7f45afe0c743e3b2a347d96c79c627822b932cc22c3900af3228f71d2880",
  "modelFileSha256": "364903586c9974f3759c5818b9d562f3883bd5115f37c1b207cab10113d26e55",
  "runtimeSha256": "415a7b1ab8105b102a2e7d5f4deac9f9d544f2fd7b4c08773dd0eee78c41d80f",
  "inputTier": "ogg-full-ten-second-window-v1",
  "receiptSha256": "484e6d13a9297549f4cd366c976fac29ee670b08efbc13c247c1eece41f0e8a1"
},
  artifacts: {
  "model": {
    "path": "fusion-model/model.json",
    "sha256": "364903586c9974f3759c5818b9d562f3883bd5115f37c1b207cab10113d26e55"
  },
  "policy": {
    "path": "fusion-model/policy.json",
    "sha256": "dbf0fdf070e66b5461fda86664d93e91652ddf63743dd3d8456b3925bc5fd755"
  },
  "adapterSource": {
    "path": "fusion-model/adapter-source.ts",
    "sha256": "a7a6f2f99715f2b805a9fef89ed639b21232e716abffb86b9d2d7344e1a835bc"
  },
  "baselineRules": {
    "path": "fusion-model/baseline-rules.json",
    "sha256": "b000e4ad89ebcfdc78847243e44bd4517749612e9a86313ce860fbe2a5597860"
  },
  "prompts": {
    "path": "fusion-model/prompts.json",
    "sha256": "60749591cdefb7d9cccb5c9b9524d71ab21f6e6f0f6a6f6ad6f94a400dca408c"
  },
  "bridgeSource": {
    "path": "fusion-model/bridge-source.mjs",
    "sha256": "f24b7f45afe0c743e3b2a347d96c79c627822b932cc22c3900af3228f71d2880"
  },
  "scorerSource": {
    "path": "fusion-model/scorer-source.mjs",
    "sha256": "f303a7a690f24f0aeb295fa243734aa0ac4879c1893457278b749458988ea3e4"
  },
  "receipt": {
    "path": "fusion-model/acceptance.json",
    "sha256": "484e6d13a9297549f4cd366c976fac29ee670b08efbc13c247c1eece41f0e8a1"
  }
},
  isRuntimeSupported: () => musicRuntimeIdentity() === 'wasm-threads-4-jamendo-1-v2',
  createScorer: bytes => createCandidateFusionScorer({
    modelBytes: bytes.model, policyBytes: bytes.policy, adapterSourceBytes: bytes.adapterSource, baselineRulesBytes: bytes.baselineRules, promptsBytes: bytes.prompts,
    expectedPolicyFileSha256: 'dbf0fdf070e66b5461fda86664d93e91652ddf63743dd3d8456b3925bc5fd755', expectedAdapterSourceSha256: 'a7a6f2f99715f2b805a9fef89ed639b21232e716abffb86b9d2d7344e1a835bc',
  }, {bridgeSourceBytes: bytes.bridgeSource, expectedBridgeSourceSha256: 'f24b7f45afe0c743e3b2a347d96c79c627822b932cc22c3900af3228f71d2880', scorerSourceBytes: bytes.scorerSource, expectedScorerSourceSha256: 'f303a7a690f24f0aeb295fa243734aa0ac4879c1893457278b749458988ea3e4'}),
};
