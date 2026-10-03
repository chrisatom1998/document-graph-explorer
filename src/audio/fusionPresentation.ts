import { FUSION_LABELS, sanitizeFusion, sanitizeFusionIdentity, type FusionAnalysis, type FusionLabel } from './fusion';
import { installedFusionIdentity, sameFusionRelease, type FusionReleaseIdentity } from './fusionRelease';
/** Display names never expand an aggregate class into an invented instrument subtype. */
export const fusionLabelText = (label: FusionLabel) => label === 'mallet_percussion' ? 'mallet percussion' : label;
export function fusionPresentation(raw: FusionAnalysis | undefined, duration: number, mode: string,
  active: FusionReleaseIdentity | undefined = installedFusionIdentity()) {
  if (!raw) return undefined;
  // Validate values separately from the source-owned activation decision.
  const f = sanitizeFusion({ ...raw, validation: 'unvalidated', release: undefined }, duration);
  if (!f) return undefined;
  const qualified = !raw.imported && raw.validation === 'policy-qualified' && sameFusionRelease(raw.release, active)
    && JSON.stringify(sanitizeFusionIdentity(raw.identity)) === JSON.stringify(sanitizeFusionIdentity(active))
    && mode === 'full' && duration === 10 && f.planned === 1 && f.counts.complete === 1
    && f.omittedWindows === 0 && f.windows.length === 1 && f.windows[0].start === 0 && f.windows[0].end === 10;
  return { qualified, windows: f.windows, counts: f.counts, omittedWindows: f.omittedWindows,
    positive: qualified ? f.windows[0].decisions.filter(d => d.state === 'positive').map(d => d.label) : [],
    labels: FUSION_LABELS };
}
