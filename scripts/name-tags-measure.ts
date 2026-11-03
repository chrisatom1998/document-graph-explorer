// Name tags (src/audio/nameSoundLexicon.ts) measured on their own, never on the audio scoreboard.
// 1) Precision / recall of name alone on FSD50K eval titles: uploader-written titles, labels from people listening, so
//    the name and the label are independent. Nothing trains on this; only per-tag counts are written.
// 2) Coverage on sample-pack paths (training manifest): how often a file gets any name tag. Pack labels there were
//    written from the path by rule, so agreement would be circular; only coverage is reported.
// LOCAL ONLY: reads test labels from the project folder; writes aggregate counts, never clip ids or titles.
// Usage (repo root): npx vite-node scripts/name-tags-measure.ts <fsd50k-eval.csv> <eval_clips_info_FSD50K.json> <manifest.jsonl> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { namedSounds } from '../src/audio/nameSoundLexicon';
import { mergedDjLabel, DJ_CATALOG, DJ_HIDDEN_LABELS, type DjGroup } from '../src/audio/djTags';

const [setCsv, infoJson, manifest, out] = process.argv.slice(2);
const groupOf = new Map(DJ_CATALOG.map(c => [c.label, c.group as DjGroup]));
const merged = (label: string) => { const g = groupOf.get(label); return g ? mergedDjLabel(g, label).label : label; };
const splitCsv = (line: string) => { const r: string[] = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(cur); cur = ''; } else cur += ch; } r.push(cur); return r; };
const info: Record<string, { title?: string }> = JSON.parse(readFileSync(infoJson, 'utf8'));
const lines = readFileSync(setCsv, 'utf8').trim().split('\n');
const head = splitCsv(lines[0]); const col = (n: string) => head.indexOf(n);
const variants = { before: { folders: false, catalogOnly: true }, after: { folders: true, catalogOnly: false } } as const;
const stats: Record<string, Record<string, { pos: number; tp: number; fp: number }>> = { before: {}, after: {} };
const named = { before: 0, after: 0 }; let n = 0;
for (const line of lines.slice(1)) {
  const r = splitCsv(line); n++;
  const present = new Set(r[col('present')].split(';').filter(Boolean).map(merged));
  const absent = new Set(r[col('absent')].split(';').filter(Boolean).map(merged).filter(l => !present.has(l)));
  const title = info[r[col('id')].split(':')[1]]?.title ?? '';
  for (const [v, opt] of Object.entries(variants) as [keyof typeof variants, typeof variants[keyof typeof variants]][]) {
    const hits = new Set(namedSounds(title, opt).map(s => s.label)); if (hits.size) named[v]++;
    for (const t of new Set([...present, ...absent])) {
      const s = (stats[v][t] ??= { pos: 0, tp: 0, fp: 0 });
      if (present.has(t)) { s.pos++; if (hits.has(t)) s.tp++; } else if (hits.has(t)) s.fp++;
    }
  }
}
const summarise = (v: 'before' | 'after') => {
  const rows = Object.entries(stats[v]).filter(([, s]) => s.pos).map(([tag, s]) => ({ tag, hidden: [...DJ_HIDDEN_LABELS].some(k => k.endsWith(':' + tag)),
    positives: s.pos, nameRight: s.tp, nameWrong: s.fp, precision: s.tp + s.fp ? +(s.tp / (s.tp + s.fp)).toFixed(3) : null, recall: +(s.tp / s.pos).toFixed(3) }));
  const fired = rows.filter(r => r.nameRight + r.nameWrong >= 5);
  const tp = rows.reduce((a, r) => a + r.nameRight, 0), fp = rows.reduce((a, r) => a + r.nameWrong, 0);
  return { titlesNamingATag: named[v], overallPrecision: +(tp / (tp + fp)).toFixed(3), tagsFiring5Plus: fired.length,
    at60Precision: fired.filter(r => r.precision! >= .6).length, under50Precision: fired.filter(r => r.precision! < .5).map(r => `${r.tag} ${r.nameRight}/${r.nameRight + r.nameWrong}`), rows };
};
const cover = { files: 0, before: 0, afterFileOnly: 0, after: 0 };
for (const line of readFileSync(manifest, 'utf8').split('\n')) {
  if (!line.trim()) continue; const { path } = JSON.parse(line) as { path: string };
  if (path.startsWith('bbc-sfx/')) continue; // bare numeric ids
  const rel = path.split('/').slice(1).join('/'); cover.files++;
  if (namedSounds(rel, variants.before).length) cover.before++;
  if (namedSounds(rel, { folders: false, catalogOnly: false }).length) cover.afterFileOnly++;
  if (namedSounds(rel, variants.after).length) cover.after++;
}
const doc = { fsd50kEval: { clips: n, before: summarise('before'), after: summarise('after') }, packCoverage: cover };
writeFileSync(out, JSON.stringify(doc, null, 1));
console.log(JSON.stringify({ clips: n, before: { ...doc.fsd50kEval.before, rows: undefined }, after: { ...doc.fsd50kEval.after, rows: undefined }, cover }, null, 1));
