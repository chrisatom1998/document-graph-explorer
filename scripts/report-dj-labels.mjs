/* Scores what the app predicted against the independent role annotations.
 * Reports per role, against the stated target of 70% precision AND 70% recall.
 * An unaccepted true sound counts as a miss; nothing here is fitted. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW = process.argv[2];
const ALIASES = process.argv[3] || 'docs/evaluations/dj-labels-2026-10-04/role-aliases.json';
const OUT = process.argv[4];
const TARGET = 0.70;

const rows = JSON.parse(readFileSync(RAW, 'utf8')).filter(r => r.status === 'ok');
const aliases = JSON.parse(readFileSync(ALIASES, 'utf8'));

/** Every label the app was willing to show for this clip, by dimension. */
function predicted(row) {
  const byDimension = { source: new Set(), production: new Set(), role: new Set(), character: new Set() };
  for (const o of row.observations ?? []) {
    const d = o.dimension === 'effect' ? 'production' : o.dimension;
    if (byDimension[d]) byDimension[d].add(o.label);
  }
  for (const t of row.djTags ?? []) if (byDimension[t.group]) byDimension[t.group].add(t.label);
  if (row.source) byDimension.source.add(row.source);
  for (const r of row.roles ?? []) byDimension.role.add(r);
  for (const c of row.character ?? []) byDimension.character.add(c);
  // Fusion decisions name instrument sources, which the alias map also draws on.
  for (const f of row.fusionPositive ?? []) byDimension.source.add(f);
  if (row.voice) { byDimension.source.add('voice'); if (row.voice.style) byDimension.production.add(row.voice.style); }
  return byDimension;
}

const report = { kind: 'dj-label-scorecard-v1', target: { precision: TARGET, recall: TARGET },
  clips: rows.length, aliasesFrom: ALIASES, roles: {} };

for (const [role, map] of Object.entries(aliases.roles)) {
  let tp = 0, fp = 0, fn = 0, tn = 0, unknown = 0;
  const falsePositives = [], falseNegatives = [];
  for (const row of rows) {
    const truth = row.truth?.[role];
    if (truth !== 0 && truth !== 1) { unknown++; continue; }
    const got = predicted(row);
    const hit = Object.entries(map).some(([dimension, labels]) => labels.some(l => got[dimension]?.has(l)));
    if (truth === 1 && hit) tp++;
    else if (truth === 0 && hit) { fp++; falsePositives.push(row.id); }
    else if (truth === 1) { fn++; falseNegatives.push(row.id); }
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  report.roles[role] = { tp, fp, fn, tn, unknown, precision, recall,
    f1: precision && recall ? 2 * precision * recall / (precision + recall) : null,
    meetsTarget: precision !== null && recall !== null && precision >= TARGET && recall >= TARGET,
    positiveSupport: tp + fn, negativeSupport: fp + tn,
    falsePositives: falsePositives.slice(0, 12), falseNegatives: falseNegatives.slice(0, 12) };
}

/** How often each individual taxonomy label fires at all: a label that never fires
 * cannot be measured here, and one that fires on everything is not discriminating. */
const fired = new Map();
for (const row of rows) {
  const got = predicted(row);
  for (const [dimension, set] of Object.entries(got)) for (const l of set) {
    const key = `${dimension}:${l}`;
    fired.set(key, (fired.get(key) ?? 0) + 1);
  }
}
report.labelActivity = [...fired.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, clips: count }));

const pad = (s, n) => String(s).padEnd(n);
const pct = v => v === null ? '    -' : `${(v * 100).toFixed(1)}%`.padStart(6);
console.log(`DJ label scorecard - ${rows.length} independently annotated loops`);
console.log(`target: precision >= 70% AND recall >= 70% per role\n`);
console.log(`${pad('role', 13)}${'pos'.padStart(5)}${'neg'.padStart(5)}${'prec'.padStart(8)}${'recall'.padStart(8)}${'  verdict'}`);
console.log('-'.repeat(52));
for (const [role, r] of Object.entries(report.roles)) {
  console.log(`${pad(role, 13)}${String(r.positiveSupport).padStart(5)}${String(r.negativeSupport).padStart(5)}${pct(r.precision)}${pct(r.recall)}  ${r.meetsTarget ? 'PASS' : 'fails'}`);
}
console.log('-'.repeat(52));
console.log(`passing both targets: ${Object.values(report.roles).filter(r => r.meetsTarget).length}/${Object.keys(report.roles).length}`);
console.log(`\ndistinct labels the app fired at least once: ${report.labelActivity.length}`);
console.log(`top 12: ${report.labelActivity.slice(0, 12).map(a => `${a.label}(${a.clips})`).join(', ')}`);

if (OUT) { writeFileSync(join(OUT, 'scorecard.json'), JSON.stringify(report, null, 1)); console.log(`\nwrote ${join(OUT, 'scorecard.json')}`); }
