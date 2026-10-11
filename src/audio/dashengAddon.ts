import policyJson from './dashengAddonPolicy.json';
import { gpuModelBlockedReason, type GpuModelNavigator } from './gpuModelPolicy';
import { taggerDecisions, type TaggerAnalysis, type TaggerDisplay, type TaggerPolicy } from './tagger';

/** Desktop Dasheng add-on (scripts/audio-model/big-teacher/export-dasheng.py): Dasheng-0.6B (Apache 2.0) plus the
 * big-teacher Dasheng heads as one int8 ONNX graph (~651 MB), downloaded from huggingface.co only after the listener
 * turns it on in Settings. On the percussion tags its policy lists, its window scores replace the trained tagger's and
 * the other detectors' evidence inside the scored windows, exactly as the tagger's own outputs do. Phones and
 * data-saver connections never download it.
 *
 * Unlike the tagger, each window is the clip's own audio at 16 kHz with no silence padding (at least 0.25 s), as the
 * teacher saw its training clips (big-teacher/features.py). */
export interface DashengAddonPolicy extends TaggerPolicy {
  /** Public Hugging Face model repository and the pinned revision the app downloads. */
  repository: string;
  repositoryRevision: string;
  downloadMB: number;
}
export const DASHENG_POLICY = policyJson as DashengAddonPolicy;
export const DASHENG_REVISION = DASHENG_POLICY.revision;
export const DASHENG_SAMPLE_RATE = DASHENG_POLICY.input.sampleRate;
/** The teacher's shortest training input (big-teacher/features.py pads shorter clips with silence to this). */
export const DASHENG_MIN_SAMPLES = 4000;
export const DASHENG_SCORE = 'Desktop Dasheng score';
export const DASHENG_MAYBE_SCORE = 'Desktop Dasheng score (maybe)';
export const DASHENG_UNAVAILABLE = 'The desktop Dasheng add-on was unavailable; the other detectors decided its tags. Reanalyze to retry.';
export const dashengModelUrl = (file: string) =>
  `https://huggingface.co/${DASHENG_POLICY.repository}/resolve/${DASHENG_POLICY.repositoryRevision}/${file}`;

/** Why this device cannot use the add-on, or null. It needs a desktop with room for a 651 MB model. */
export function dashengBlockedReason(nav: GpuModelNavigator & { hardwareConcurrency?: number }): string | null {
  const gpu = gpuModelBlockedReason(nav);
  if (gpu) return gpu.startsWith('Phone') ? 'Desktop only: phones and tablets keep the small tagger' : gpu;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 8) return 'Needs a computer with at least 8 GB of memory';
  return null;
}

/** Display switch, kept in step with the setting (settingsStore): turning the add-on off restores the other detectors'
 * tags at once, without reanalysis. */
let displayEnabled = false;
export function setDashengDisplayEnabled(on: boolean): void { displayEnabled = on; }
export const dashengDisplayEnabled = () => displayEnabled;

/** One model input: the window's own samples, padded with silence only up to the teacher's 0.25 s minimum. */
export function dashengWindow(samples: Float32Array): Float32Array {
  if (samples.length >= DASHENG_MIN_SAMPLES) return samples.length > DASHENG_POLICY.input.windowSamples ? samples.slice(0, DASHENG_POLICY.input.windowSamples) : samples;
  const out = new Float32Array(DASHENG_MIN_SAMPLES);
  out.set(samples);
  return out;
}

/** The add-on's decisions for a stored result, only while the add-on is turned on, and only over the same windows the
 * tagger scored (its coverage decides where other detectors' evidence is replaced). */
export function dashengDecisions(dasheng: TaggerAnalysis | undefined, tagger: TaggerAnalysis | undefined, durationSeconds: number): TaggerDisplay[] | undefined {
  if (!displayEnabled || !dasheng || !tagger || dasheng.windows !== tagger.windows) return;
  return taggerDecisions(dasheng, durationSeconds, DASHENG_POLICY);
}
