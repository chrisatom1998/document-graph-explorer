// Compare a change's held-out accuracy with its base branch and fail if any number dropped by more than noise.
// Usage: node scripts/accuracy-gate/compare.mjs <base-dir|-> <head-dir> <summary.md>
// Each dir holds the reports of scripts/holdout-r3/score-tags.mjs (jamendo-tags.json: weak view,
// jamendo-tags-strict.json: strict view) and score-tempo-key.mjs (mtgkey.json). With "-" as base, only the head's
// numbers are written. Exit code 1 when any gated number regressed (unless REPORT_ONLY=1).
//
// Gated numbers, each compared with the base branch rather than the fixed 0.60 bar, so a failing tag can't get worse:
//   sound tags: recall of every class with >= 10 labelled positives; precision of every class the base showed
//     >= 10 times (weak view: untagged counts as absent, so it is a floor, but the same floor on both sides);
//     voice precision on the strict view (three annotators agreed on instrumental);
//   tempo: share of tracks within 4% of the Beatport BPM, and also allowing half/double/triple;
//   key: exact-key rate and MIREX weighted score over tracks with a confident annotated key;
//   coverage: tracks analysed (a crash or timeout must not hide as "missing").
// A drop counts only beyond max(0.02, 1.5 / n), n being the number the rate is taken over, so one track flipping
// (and run-to-run noise) never fails a change, while two or more lost tracks on a small class do.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [baseDir, headDir, summaryPath] = process.argv.slice(2);
if (!headDir || !summaryPath) throw new Error('Usage: node scripts/accuracy-gate/compare.mjs <base-dir|-> <head-dir> <summary.md>');
export const MIN_N = 10, ABS_TOL = 0.02, FLIP_TOL = 1.5, BAR = 0.6;
const load = dir => {
  const read = f => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return { weak: read('jamendo-tags.json'), strict: read('jamendo-tags-strict.json'), key: read('mtgkey.json') };
};
const head = load(headDir), base = baseDir && baseDir !== '-' && existsSync(join(baseDir, 'mtgkey.json')) ? load(baseDir) : null;

/** Every gated number as { name, group, value, n } for one side; n is the denominator the base's tolerance uses. */
function metrics(s) {
  const out = [];
  for (const [k, v] of Object.entries(s.weak.displayedIncludingMaybe)) {
    const cls = k.replace('source:', '');
    out.push({ name: `${cls} recall`, group: 'tags', cls, value: v.recall, n: v.positives });
    out.push({ name: `${cls} precision`, group: 'tags', cls, value: v.precision, n: v.truePositives + v.falseDetections });
  }
  const sv = s.strict.displayedIncludingMaybe['source:voice'];
  if (sv) out.push({ name: 'voice precision (agreed labels)', group: 'tags', cls: 'voice', value: sv.precision, n: sv.truePositives + sv.falseDetections });
  const a = s.key.summary.all;
  out.push({ name: 'tempo within 4%', group: 'tempo', value: a.acc1OfAll, n: a.clips });
  out.push({ name: 'tempo within 4% or 2x/½x/3x/⅓x', group: 'tempo', value: a.acc2OfAll, n: a.clips });
  out.push({ name: 'key exact', group: 'key', value: a.keyExactRate, n: a.keyScored });
  out.push({ name: 'key MIREX score', group: 'key', value: a.keyMirex, n: a.keyScored });
  out.push({ name: 'Jamendo tracks analysed', group: 'coverage', value: s.weak.analysed / s.weak.items, n: s.weak.items, count: s.weak.analysed });
  out.push({ name: 'MTG key tracks analysed', group: 'coverage', value: s.key.analysed / s.key.items, n: s.key.items, count: s.key.analysed });
  return out;
}
const fmt = v => (v == null ? '—' : v.toFixed(3));
const h = metrics(head), b = base ? new Map(metrics(base).map(m => [m.name, m])) : null;
// A tag passes when the base shows it with precision and recall both at or above the 0.60 bar.
const passing = cls => b && ['recall', 'precision'].every(k => b.get(`${cls} ${k}`)?.value >= BAR);
const rows = [], failures = [];
for (const m of h) {
  const bm = b?.get(m.name);
  // Coverage has no tolerance: every track the base analysed must still be analysed.
  const tol = m.group === 'coverage' ? 0 : Math.max(ABS_TOL, FLIP_TOL / Math.max(1, bm?.n ?? m.n));
  const gated = bm != null && bm.value != null && bm.n >= (m.group === 'coverage' ? 1 : MIN_N);
  const delta = gated && m.value != null ? m.value - bm.value : null;
  // A precision that vanished (the head never shows the tag) is caught by that tag's recall instead.
  const regressed = delta != null && delta < -tol - 1e-9;
  const lostTag = gated && m.value == null;
  const status = !b ? '' : !gated ? 'not gated (too few)' : regressed ? '❌ dropped' : lostTag ? 'ℹ️ no longer shown' : delta > tol ? '✅ improved' : 'ok';
  if (regressed) failures.push(m.name);
  rows.push(`| ${m.name} | ${bm ? fmt(bm.value) : ''} | ${fmt(m.value)} | ${delta == null ? '' : (delta >= 0 ? '+' : '') + delta.toFixed(3)} | ${gated ? '±' + tol.toFixed(3) : ''} | ${bm?.n ?? m.n} | ${status}${m.cls && passing(m.cls) ? ' (passing tag)' : ''} |`);
}
const verdict = !base ? 'No base numbers to compare with; recorded these as a baseline only.'
  : failures.length ? `**Accuracy dropped** on ${failures.length} number${failures.length > 1 ? 's' : ''}: ${failures.join(', ')}.`
  : 'No held-out number dropped beyond noise.';
const md = [`### Accuracy gate (${head.weak.items} Jamendo tracks, ${head.key.items} MTG key tracks)`, '', verdict, '',
  '| Number | Base | This change | Change | Allowed drop | n | |', '|---|---|---|---|---|---|---|', ...rows, '',
  'Round 3 held-out set (docs/evaluations/holdout-r3-2026-10-06): judge with it, never tune on it. Only these aggregates are reported.'].join('\n');
writeFileSync(summaryPath, md + '\n');
console.log(md);
if (failures.length && process.env.REPORT_ONLY !== '1') process.exit(1);
