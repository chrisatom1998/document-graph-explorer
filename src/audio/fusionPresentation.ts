import { FUSION_LABELS, sanitizeFusion, sanitizeFusionIdentity, type FusionAnalysis, type FusionLabel } from './fusion';
import { FUSION_MINIMUM_SECONDS, installedFusionIdentity, sameFusionRelease, type FusionReleaseIdentity } from './fusionRelease';
/** Display names never expand an aggregate class into an invented instrument subtype. */
export const fusionLabelText = (label: FusionLabel) => label === 'mallet_percussion' ? 'mallet percussion' : label;
export function fusionPresentation(raw: FusionAnalysis | undefined, duration: number, mode: string,
  active: FusionReleaseIdentity | undefined = installedFusionIdentity()) {
  if (!raw) return undefined;
  // Validate values separately from the source-owned activation decision.
  const f = sanitizeFusion({ ...raw, validation: 'unvalidated', release: undefined }, duration);
  if (!f) return undefined;
  // Every window is scored at the fitted window length, so a longer recording is
  // repeated applications of the qualified decision rather than a new one. A window
  // that produced no native output (silence) is skipped; a failed or unsupported
  // window means the recording was not fully scored and nothing is presented.
  const complete = f.windows.filter(w => w.status === 'complete');
  const qualified = !raw.imported && raw.validation === 'policy-qualified' && sameFusionRelease(raw.release, active)
    && JSON.stringify(sanitizeFusionIdentity(raw.identity)) === JSON.stringify(sanitizeFusionIdentity(active))
    && mode === 'full' && duration >= FUSION_MINIMUM_SECONDS && f.omittedWindows === 0
    && f.counts.complete >= 1 && f.counts.failed === 0 && f.counts.unsupported === 0;
  // An instrument heard in any fully scored window is present in the recording;
  // requiring every window would discard anything that does not play throughout.
  const positive = qualified
    ? [...new Set(complete.flatMap(w => w.decisions.filter(d => d.state === 'positive').map(d => d.label)))]
    : [];
  return { qualified, windows: f.windows, counts: f.counts, omittedWindows: f.omittedWindows,
    positive, labels: FUSION_LABELS };
}
