/* Compares per-label tag accuracy across saved evaluation reports, so a model swap can be judged label by label.
 * Usage: node scripts/compare-tag-reports.mjs [--bar 0.60] [--min-positives 10] [--view including|without] <report.json>...
 * The first report is the reference; later ones show what passed or failed versus it.
 * Reads short-clip reports (`displayedIncludingMaybe`) and DJ-label scorecards (`roles`). Nothing is recomputed:
 * each label's precision and recall come from the report itself, then are held to the same bar. */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const BAR = Number(option('--bar', '0.60'));
const MIN_POSITIVES = Number(option('--min-positives', '10'));
const VIEW = option('--view', 'including');
if (!args.length || !(BAR > 0 && BAR <= 1)) throw new Error('Usage: node scripts/compare-tag-reports.mjs [--bar 0.60] [--min-positives 10] [--view including|without] <report.json>...');

/** label -> { precision, recall, positives } for one report. */
function labels(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const table = report.roles ?? report[VIEW === 'without' ? 'displayedWithoutMaybe' : 'displayedIncludingMaybe'];
  if (!table) throw new Error(`${file}: no per-label table (expected "roles" or "displayedIncludingMaybe")`);
  const out = new Map();
  for (const [label, r] of Object.entries(table)) {
    out.set(label, { precision: r.precision ?? null, recall: r.recall ?? null, positives: r.positives ?? r.positiveSupport ?? 0 });
  }
  return out;
}

const passes = r => r != null && r.precision != null && r.recall != null && r.precision >= BAR && r.recall >= BAR;
const pct = v => (v == null ? '—' : v.toFixed(2));
const reports = args.map(file => ({ name: basename(file, '.json'), labels: labels(file) }));
const all = [...new Set(reports.flatMap(r => [...r.labels.keys()]))].sort();
const bar = `${Math.round(BAR * 100)}/${Math.round(BAR * 100)}`;

console.log(`Pass bar: precision AND recall >= ${BAR.toFixed(2)} (${bar}). Labels with fewer than ${MIN_POSITIVES} positives are marked "low".\n`);
console.log(`| Label | Positives | ${reports.map(r => `${r.name} P / R`).join(' | ')} | ${reports.map(r => `${r.name} pass`).join(' | ')} | Change |`);
console.log(`|---|---|${reports.map(() => '---|').join('')}${reports.map(() => '---|').join('')}---|`);
for (const label of all) {
  const rows = reports.map(r => r.labels.get(label));
  const positives = Math.max(...rows.map(r => r?.positives ?? 0));
  const first = passes(rows[0]), last = passes(rows.at(-1));
  const change = reports.length < 2 || first === last ? '' : last ? 'now passes' : 'now fails';
  console.log(`| ${label} | ${positives}${positives < MIN_POSITIVES ? ' (low)' : ''} | ${rows.map(r => `${pct(r?.precision)} / ${pct(r?.recall)}`).join(' | ')} | ${rows.map(r => (passes(r) ? 'yes' : 'no')).join(' | ')} | ${change} |`);
}
console.log('');
for (const r of reports) {
  const measurable = all.filter(l => (r.labels.get(l)?.positives ?? 0) > 0);
  console.log(`${r.name}: ${measurable.filter(l => passes(r.labels.get(l))).length}/${measurable.length} measurable labels meet ${bar}`);
}
