/** Scores src/audio/structure.ts against the Raveform labels using the features the Actions workflow committed.
 * usage: vite-node scripts/structure-evaluate.ts [tune|test|all] [params-json]
 * Folds 0-3 are for tuning, folds 4-7 are held out. Prints JSON metrics. */
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { detectStructure, DEFAULT_STRUCTURE_PARAMS, STRUCTURE_FEATURES, type StructureParams } from '../src/audio/structure';

const DIR = 'docs/evaluations/structure-2026-10-06/features';
type Label = { fold: number; genre: string; duration: number; average_bpm: number; sections: { name: string; start: number; end: number }[] };

export function loadSet(split = 'all') {
  const labels: Record<string, Label> = JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8'));
  const tracks: { key: string; label: Label; blocks: number[][]; ms: number; duration: number }[] = [];
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.json.gz')).sort()) {
    const shard = JSON.parse(gunzipSync(readFileSync(`${DIR}/${file}`)).toString()) as Record<string, { duration: number; ms: number; blocks: string }>;
    for (const [key, f] of Object.entries(shard)) {
      const label = labels[key];
      if (!label) continue;
      if (split === 'tune' && label.fold >= 4) continue;
      if (split === 'test' && label.fold < 4) continue;
      const buf = Buffer.from(f.blocks, 'base64'), packed = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), w = STRUCTURE_FEATURES.length;
      const blocks = Array.from({ length: packed.length / w }, (_, i) => Array.from(packed.subarray(i * w, i * w + w), v => v / 10));
      tracks.push({ key, label, blocks, ms: f.ms, duration: f.duration });
    }
  }
  return tracks;
}

/** Starts of drop sections that follow something other than a drop. */
export const dropEntries = (label: Label) => label.sections.filter((s, i) => s.name === 'drop' && label.sections[i - 1]?.name !== 'drop').map(s => s.start);

export function score(tracks: ReturnType<typeof loadSet>, params: StructureParams = DEFAULT_STRUCTURE_PARAMS) {
  // The quick scan's single 10 s window: does it land inside a labelled drop? First drop vs the old middle window.
  const inDrop = (label: Label, a: number) => label.sections.some(x => x.name === 'drop' && a >= x.start - 0.5 && a + 10 <= x.end + 0.5);
  let windowInDrop = 0, middleInDrop = 0;
  let withDrop = 0, none = 0, hit2 = 0, hit4 = 0, hit8 = 0, tp = 0, predicted = 0, truth = 0, falseOnNoDrop = 0, noDropTracks = 0;
  const errors: number[] = [], rows: { key: string; truth?: number; predicted?: number }[] = [];
  for (const t of tracks) {
    // Audio and labels can be offset by a different upload; a duration mismatch over 3 s is skipped.
    const s = detectStructure(t.blocks, params), gt = dropEntries(t.label);
    predicted += s.drops.length;
    if (!gt.length) { noDropTracks++; if (s.drops.length) falseOnNoDrop++; continue; }
    withDrop++; truth += gt.length;
    for (const d of gt) if (s.drops.some(p => Math.abs(p - d) <= 2)) tp++;
    const first = s.drops[0], middle = Math.max(0, t.duration / 2 - 5);
    if (inDrop(t.label, first !== undefined && first + 10 <= t.duration ? first : middle)) windowInDrop++;
    if (inDrop(t.label, middle)) middleInDrop++;
    rows.push({ key: t.key, truth: gt[0], predicted: first });
    if (first === undefined) { none++; continue; }
    const e = Math.abs(first - gt[0]); errors.push(e);
    if (e <= 2) hit2++; if (e <= 4) hit4++; if (e <= 8) hit8++;
  }
  errors.sort((a, b) => a - b);
  const pct = (n: number, d: number) => Math.round(n / Math.max(1, d) * 1000) / 10;
  return {
    tracks: tracks.length, withDrop, firstDropWithin2s: pct(hit2, withDrop), within4s: pct(hit4, withDrop), within8s: pct(hit8, withDrop),
    noDropFound: pct(none, withDrop), medianFirstDropError: errors[Math.floor(errors.length / 2)],
    quickWindowInDrop: pct(windowInDrop, withDrop), middleWindowInDrop: pct(middleInDrop, withDrop),
    dropPrecision2s: pct(tp, predicted), dropRecall2s: pct(tp, truth), noDropTracks, dropsClaimedOnNoDropTracks: falseOnNoDrop,
    featureMsPerMinute: Math.round(tracks.reduce((n, t) => n + t.ms, 0) / Math.max(1, tracks.reduce((n, t) => n + t.duration / 60, 0))),
    rows,
  };
}

if (!process.env.VITEST) {
  const [split = 'tune', params] = process.argv.slice(2);
  const { rows, ...metrics } = score(loadSet(split), params ? { ...DEFAULT_STRUCTURE_PARAMS, ...JSON.parse(params) } : undefined);
  console.log(JSON.stringify(metrics, null, 1));
  void rows;
}
