import { QUALIFIED_FUSION_RELEASE } from './qualifiedFusionRelease';
import { FUSION_LABELS, sanitizeFusionIdentity, type FusionIdentity, type FusionScorer } from './fusion';

export const FUSION_INPUT_TIER = 'ogg-full-ten-second-window-v1' as const;
export interface FusionReleaseIdentity extends FusionIdentity {
  modelFileSha256: string;
  receiptSha256: string;
  runtimeSha256: string;
  inputTier: typeof FUSION_INPUT_TIER;
}
export interface FusionArtifact { path: string; sha256: string }
export interface FusionRelease {
  identity: FusionReleaseIdentity;
  /** Must check the qualified execution backend/thread condition before loading. */
  isRuntimeSupported(): boolean;
  artifacts: Record<'model' | 'policy' | 'adapterSource' | 'baselineRules' | 'prompts' | 'bridgeSource' | 'scorerSource' | 'receipt', FusionArtifact>;
  /** The reviewed, compiled factory; never evaluated from downloaded source. */
  createScorer(artifacts: Record<keyof FusionRelease['artifacts'], Uint8Array>): Promise<FusionScorer>;
}
/** Source-owned activation binds the accepted release and pinned artifacts.
 * No settings, imported graph, URL parameter or supplied receipt can install a release. */
export const BUILT_IN_FUSION_RELEASE: FusionRelease | undefined = QUALIFIED_FUSION_RELEASE;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const check: (v: unknown, message: string) => asserts v = (v, message) => { if (!v) throw new Error(message); };
export function sanitizeFusionReleaseIdentity(raw: unknown): FusionReleaseIdentity | undefined {
  const r = raw as FusionReleaseIdentity | undefined, identity = sanitizeFusionIdentity(r);
  return identity && r && digest(r.modelFileSha256) && digest(r.receiptSha256) && digest(r.runtimeSha256) && r.inputTier === FUSION_INPUT_TIER
    ? { ...identity, modelFileSha256: r.modelFileSha256, receiptSha256: r.receiptSha256, runtimeSha256: r.runtimeSha256, inputTier: r.inputTier } : undefined;
}
export function sameFusionRelease(a: unknown, b: unknown): boolean {
  const x = sanitizeFusionReleaseIdentity(a), y = sanitizeFusionReleaseIdentity(b);
  return !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
}
const configuredRelease = (): FusionRelease | undefined => BUILT_IN_FUSION_RELEASE;
export const installedFusionIdentity = (): FusionReleaseIdentity | undefined => configuredRelease()?.identity;
export const fusionConfiguration = () => JSON.stringify(installedFusionIdentity() ?? 'disabled');
export const fusionRuntimeSupported = () => configuredRelease()?.isRuntimeSupported() ?? false;
export function supportsFusionInput(duration: number, mode: string, mime?: string): boolean {
  return mode === 'full' && duration === 10 && (mime === 'audio/ogg' || mime === 'application/ogg');
}
async function sha(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Explicit preparation API for independently qualified factories. Calling it does not install one. */
export async function loadFusionRelease(release: FusionRelease, fetchBytes: (path: string) => Promise<Uint8Array>): Promise<FusionScorer> {
  const identity = sanitizeFusionReleaseIdentity(release.identity);
  check(identity, 'Invalid fixed fusion release');
  const refs = structuredClone(release.artifacts), bytes = {} as Record<keyof FusionRelease['artifacts'], Uint8Array>;
  for (const name of ['model', 'policy', 'adapterSource', 'baselineRules', 'prompts', 'bridgeSource', 'scorerSource', 'receipt'] as const) {
    const ref = refs[name];
    check(ref && digest(ref.sha256) && /^fusion-model\/[a-zA-Z0-9._/-]+$/.test(ref.path) && !ref.path.split('/').includes('..'), 'Invalid local fusion artifact');
    const value = new Uint8Array(await fetchBytes(ref.path));
    check(await sha(value) === ref.sha256, 'Fusion artifact bytes changed: ' + name); bytes[name] = value;
  }
  const parse = (name: keyof typeof bytes) => JSON.parse(new TextDecoder().decode(bytes[name]));
  const model = parse('model'), policy = parse('policy'), receipt = parse('receipt');
  check(refs.model.sha256 === identity.modelFileSha256 && refs.policy.sha256 === identity.policySha256 && refs.receipt.sha256 === identity.receiptSha256, 'Release file binding mismatch');
  check(JSON.stringify(model.labels) === JSON.stringify(FUSION_LABELS) && JSON.stringify(policy.labels) === JSON.stringify(FUSION_LABELS), 'Incomplete release taxonomy');
  check(refs.bridgeSource.sha256 === identity.scorerSha256 && policy.selectionEvidence?.reviewedScorerSha256 === refs.scorerSource.sha256, 'Release scorer binding mismatch');
  check(policy.inputSupport?.rule === 'app-mse-v1' && policy.inputSupport.threshold === 1e-8 && policy.inputSupport.comparison === '>' && policy.inputSupport.minimumSeconds === 2.048, 'Unsupported input policy');
  check(model.modelSha256 === identity.modelSha256 && policy.modelSha256 === identity.modelSha256 && policy.modelFileSha256 === identity.modelFileSha256, 'Release model mismatch');
  check(policy.kind === 'openmic-fusion-selected-policy' && policy.featureContract === 'browser-openmic-score-heads-v1' && policy.adapterSourceSha256 === refs.adapterSource.sha256 && policy.baselineRulesSha256 === refs.baselineRules.sha256 && policy.promptsSha256 === refs.prompts.sha256, 'Release policy dependency mismatch');
  check(receipt.kind === 'audio-fusion-release-acceptance-v1' && sameFusionRelease({ ...receipt.identity, receiptSha256: identity.receiptSha256 }, identity), 'Acceptance receipt identity mismatch');
  check(receipt.heldOut?.count === 256 && receipt.heldOut?.dataSelectionSha256 === '4aee29d9debd611b45a02325877ac2a212178c7f8d7bb404503a399c71d8237d' && receipt.heldOut?.allClasses === 20 && receipt.heldOut?.status === 'pass' && Number.isFinite(receipt.heldOut.microF1) && receipt.heldOut.microF1 >= .75 && digest(receipt.heldOut.reportSha256), 'Held-out acceptance missing');
  check(receipt.application?.status === 'pass' && digest(receipt.application.reportSha256) && digest(receipt.application.amendmentSha256) && receipt.application.inputTier === identity.inputTier, 'Actual application qualification missing');
  const scorer = await release.createScorer(bytes);
  check(JSON.stringify(sanitizeFusionIdentity(scorer.identity)) === JSON.stringify(sanitizeFusionIdentity(identity)), 'Compiled scorer identity mismatch');
  return scorer;
}
const installedScorers = new WeakMap<FusionScorer, FusionReleaseIdentity>();
export function releaseForScorer(scorer: FusionScorer | undefined): FusionReleaseIdentity | undefined {
  const identity = scorer && installedScorers.get(scorer);
  return sameFusionRelease(identity, installedFusionIdentity()) ? identity : undefined;
}
let pending: Promise<FusionScorer | undefined> | undefined;
export function loadBuiltInFusion(): Promise<FusionScorer | undefined> {
  const release = configuredRelease();
  if (!release) return Promise.resolve(undefined);
  if (!release.isRuntimeSupported()) return Promise.resolve(undefined);
  return pending ??= loadFusionRelease(release, async path => {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!response.ok) throw new Error('Fusion artifact unavailable');
    return new Uint8Array(await response.arrayBuffer());
  }).then(scorer => { installedScorers.set(scorer, release.identity); return scorer; }).catch(error => { pending = undefined; throw error; });
}
