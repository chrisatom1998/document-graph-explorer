import { spectralCosine, validateFingerprint, type Fingerprint } from './fingerprint';
import { isSha256, type ImportedReference } from './referenceLibrary';

export interface Candidate { reference: ImportedReference; fingerprint: Fingerprint; pcmSha256?: string; processing?: { description: string; parentReferenceId: string } }
export interface Alignment { referenceOffsetSeconds: number; referenceSecondsPerQuerySecond: number; pitchSemitones: number; queryCoverage: number; framesCompared: number }
export interface RankedMatch {
  referenceId: string; familyId: string; score: number; alignment: Alignment;
  components: { spectral: number; envelope: number; modulation: number; stereo: number };
  processing?: Candidate['processing'];
}
export interface RejectionPolicy { calibrationId: string; minScore: number; minFamilyMargin: number; minCoverage: number; minFrames: number }
export interface SearchOptions { shortlist?: number; pitchSemitones?: number[]; timeScales?: number[]; policy?: RejectionPolicy }
export interface MatchResult {
  decision: 'verified-origin' | 'closest-reference-preset' | 'resemblance' | 'unknown';
  reason: string;
  exact: { basis: 'file-sha256' | 'pcm-sha256'; referenceIds: string[] } | null;
  ranked: RankedMatch[];
  calibrationId: string | null;
}

function validatePolicy(p: RejectionPolicy): void {
  if (!p.calibrationId?.trim() || !Number.isFinite(p.minScore) || p.minScore < 0 || p.minScore > 1 || !Number.isFinite(p.minFamilyMargin) || p.minFamilyMargin < 0 || p.minFamilyMargin > 1 || !Number.isFinite(p.minCoverage) || p.minCoverage < 0.5 || p.minCoverage > 1 || !Number.isInteger(p.minFrames) || p.minFrames < 4) throw new Error('invalid calibration policy');
}
const defaultPitches = Array.from({ length: 25 }, (_, i) => i - 12);
const defaultScales = [0.75, 0.9, 1, 1.1, 1.25, 1.5];

function align(query: Fingerprint, candidate: Candidate, shifts: number[], scales: number[]): RankedMatch {
  const ref = candidate.fingerprint;
  let best = { spectral: 0, offset: 0, scale: 1, shift: 0, count: 0 };
  // Coarse search bounds long-clip work; refine the winning offset at native hop resolution.
  const offsetStep = Math.max(1, Math.ceil(ref.frames.length / 96));
  const queryStep = Math.max(1, Math.ceil(query.frames.length / 16));
  const compare = (offset: number, scale: number, shift: number, step: number) => {
    const count = Math.min(query.frames.length, Math.floor((ref.frames.length - 1 - offset) / scale) + 1);
    if (count < Math.max(4, Math.ceil(query.frames.length * 0.8))) return;
    let sum = 0; let sampled = 0;
    for (let i = 0; i < count; i += step) { sum += spectralCosine(query.frames[i], ref.frames[offset + Math.round(i * scale)], shift); sampled++; }
    const spectral = sum / sampled * count / query.frames.length;
    if (spectral > best.spectral) best = { spectral, offset, scale, shift, count };
  };
  for (const shift of shifts) for (const scale of scales) {
    for (let offset = 0; offset < ref.frames.length; offset += offsetStep) {
      compare(offset, scale, shift, queryStep);
    }
  }
  if (best.count) {
    const coarse = { ...best }; best.spectral = 0;
    for (let offset = Math.max(0, coarse.offset - offsetStep); offset <= Math.min(ref.frames.length - 1, coarse.offset + offsetStep); offset++) compare(offset, coarse.scale, coarse.shift, 1);
  }
  const qEnergy: number[] = []; const rEnergy: number[] = []; let stereo = 0;
  for (let i = 0; i < best.count; i++) {
    const j = best.offset + Math.round(i * best.scale);
    qEnergy.push(query.envelope[i]); rEnergy.push(ref.envelope[j]);
    stereo += 1 - Math.abs(query.stereoWidth[i] - ref.stereoWidth[j]);
  }
  const envelope = vectorCosine(qEnergy, rEnergy);
  // Temporal spectral movement provides a small modulation check, not a synth classifier.
  const qMovement: number[] = []; const rMovement: number[] = [];
  for (let i = 1; i < best.count; i++) {
    qMovement.push(1 - spectralCosine(query.frames[i - 1], query.frames[i], 0));
    const j = best.offset + Math.round(i * best.scale); const previous = best.offset + Math.round((i - 1) * best.scale);
    rMovement.push(1 - spectralCosine(ref.frames[previous], ref.frames[j], 0));
  }
  const modulation = vectorCosine(qMovement, rMovement);
  stereo = best.count ? stereo / best.count : 0;
  return { referenceId: candidate.reference.record.id, familyId: candidate.reference.record.familyId,
    score: best.count ? 0.8 * best.spectral + 0.1 * envelope + 0.05 * modulation + 0.05 * stereo : 0,
    components: { spectral: best.spectral, envelope, modulation, stereo },
    alignment: { referenceOffsetSeconds: best.offset * ref.hopSeconds, referenceSecondsPerQuerySecond: best.scale, pitchSemitones: best.shift, queryCoverage: best.count / query.frames.length, framesCompared: best.count },
    ...(candidate.processing ? { processing: candidate.processing } : {}) };
}
function vectorCosine(a: number[], b: number[]): number {
  if (!a.length) return 0;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  if (aa < 1e-10 && bb < 1e-10) return 1;
  return aa && bb ? Math.min(1, dot / Math.sqrt(aa * bb)) : 0;
}

/** Hashes supplied here must be computed from query/reference bytes, never filenames. */
export function matchSource(query: Fingerprint, candidates: Candidate[], options: SearchOptions = {}, hashes: { fileSha256?: string; pcmSha256?: string } = {}): MatchResult {
  validateFingerprint(query);
  if (Object.values(hashes).some(h => !isSha256(h))) throw new Error('invalid query hash');
  if (options.policy) validatePolicy(options.policy);
  const ids = new Set<string>();
  for (const candidate of candidates) {
    validateFingerprint(candidate.fingerprint);
    if (ids.has(candidate.reference.record.id)) throw new Error('duplicate candidate id');
    ids.add(candidate.reference.record.id);
    if (!isSha256(candidate.reference.record.asset.sha256) || candidate.pcmSha256 !== undefined && !isSha256(candidate.pcmSha256)) throw new Error('invalid candidate hash');
  }
  const basis = hashes.fileSha256 && candidates.some(c => !c.processing && c.reference.record.asset.sha256 === hashes.fileSha256) ? 'file-sha256' : hashes.pcmSha256 && candidates.some(c => c.pcmSha256 === hashes.pcmSha256) ? 'pcm-sha256' : null;
  if (basis) {
    const duplicates = candidates.filter(c => basis === 'file-sha256' ? !c.processing && c.reference.record.asset.sha256 === hashes.fileSha256 : c.pcmSha256 === hashes.pcmSha256);
    const origins = new Set(duplicates.map(c => JSON.stringify([c.reference.record.familyId, c.reference.record.identity])));
    // Processed variants cannot borrow their parent's hash/provenance to prove an origin.
    const verified = origins.size === 1 && duplicates.every(c => c.reference.trust === 'verified' && !c.processing);
    return { decision: verified ? 'verified-origin' : 'resemblance', reason: verified ? 'Exact artifact match with explicitly verified hash-bound provenance.' : 'Exact duplicate found; origin provenance is unverified, synthetic, processed, or conflicting.', exact: { basis, referenceIds: duplicates.map(c => c.reference.record.id) }, ranked: [], calibrationId: options.policy?.calibrationId ?? null };
  }
  const pitches = options.pitchSemitones ?? defaultPitches; const scales = options.timeScales ?? defaultScales;
  const shortlist = options.shortlist ?? 12;
  if (!Number.isInteger(shortlist) || shortlist < 1 || shortlist > 100 || !pitches.length || pitches.length > 49 || pitches.some(p => !Number.isInteger(p) || Math.abs(p) > 24) || !scales.length || scales.length > 20 || scales.some(s => !Number.isFinite(s) || s < 0.5 || s > 2)) throw new Error('invalid bounded search options');
  const pooled = candidates.map(candidate => ({ candidate, score: Math.max(...pitches.map(p => spectralCosine(query.summary, candidate.fingerprint.summary, p))) }));
  pooled.sort((a, b) => b.score - a.score || a.candidate.reference.record.id.localeCompare(b.candidate.reference.record.id));
  const ranked = pooled.slice(0, shortlist).map(({ candidate }) => align(query, candidate, pitches, scales)).sort((a, b) => b.score - a.score || a.referenceId.localeCompare(b.referenceId));
  const base = { exact: null, ranked, calibrationId: options.policy?.calibrationId ?? null };
  const first = ranked[0];
  if (!first || !first.alignment.framesCompared) return { ...base, decision: 'unknown', reason: 'No usable reference alignment.' };
  if (!options.policy) return { ...base, decision: 'resemblance', reason: 'No held-out calibration policy supplied; similarity is not an origin probability.' };
  const secondFamily = ranked.find(r => r.familyId !== first.familyId);
  // A truncated shortlist cannot establish uniqueness against unexamined families.
  const truncated = pooled.length > shortlist;
  const margin = secondFamily ? first.score - secondFamily.score : truncated ? 0 : first.score;
  const policy = options.policy;
  if (first.score < policy.minScore || margin < policy.minFamilyMargin || first.alignment.queryCoverage < policy.minCoverage || first.alignment.framesCompared < policy.minFrames) return { ...base, decision: 'unknown', reason: 'Below calibrated score, family margin, coverage, or evidence requirement.' };
  const reference = candidates.find(c => c.reference.record.id === first.referenceId)!;
  return { ...base, decision: reference.reference.trust === 'verified' && reference.reference.record.kind === 'preset-render' ? 'closest-reference-preset' : 'resemblance', reason: 'Aligned candidate passes the supplied calibration policy; audio similarity does not verify original synth or preset.' };
}
