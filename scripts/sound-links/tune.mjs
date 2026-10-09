// Scores "sounds alike" links built from CLAP fingerprints alone, over a grid of link policies.
// Usage: npx vite-node scripts/sound-links/tune.mjs <manifest.json> <embeddings.jsonl> [out.json] [policy-json | shipped] [styles.json]
// Each clip becomes an audio node whose only evidence is its fingerprint (as the app stores it), plus its strongest
// Discogs styles when a styles file is given (scripts/genre-energy/features.mjs output), so this measures the
// sound-similarity part of src/audio/musicLinks.ts. Precision = share of links whose two clips share the label.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildMusicEdges, SOUND_LINK_POLICY } from '../../src/audio/musicLinks';
import { KEPT_STYLES } from '../../src/audio/genreEnergy';

const [manifestPath, embeddingsPath, outPath, policyArg, stylesPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const vectors = new Map(readFileSync(embeddingsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r.embedding]));
const items = manifest.items.filter(i => vectors.has(i.id));
// The app keeps each track's KEPT_STYLES strongest styles (GenreEnergyScores.styleList).
const styleClasses = stylesPath && JSON.parse(readFileSync('public/jamendo-model/discogs-effnet-bsdynamic-1.json', 'utf8')).classes;
const styles = new Map(stylesPath ? JSON.parse(readFileSync(stylesPath, 'utf8')).filter(r => r.styles).map(r => [r.id,
  r.styles.map((score, i) => ({ label: styleClasses[i], score: +score.toFixed(4) })).sort((a, b) => b.score - a.score).slice(0, KEPT_STYLES)]) : []);
const seconds = manifest.kind === 'songs' ? 10 : 4;
const relations = manifest.kind === 'songs' ? ['genre', 'artist'] : ['family', 'instrument'];
const unit = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const mean = new Array(512).fill(0);
for (const i of items) unit(vectors.get(i.id)).forEach((x, d) => { mean[d] += x / items.length; });

function nodes(center) {
  return items.map(i => {
    const v = unit(vectors.get(i.id));
    return { id: i.id, title: i.id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: 0, status: 'ok',
      audio: { version: 2, durationSeconds: seconds, analyzedSeconds: seconds, instruments: [], notes: [], ...(styles.has(i.id) ? { styles: styles.get(i.id) } : {}), embedding: unit(center ? v.map((x, d) => x - mean[d]) : v).map(x => Math.round(x * 1e4) / 1e4) } };
  });
}
const label = Object.fromEntries(items.map(i => [i.id, i.labels]));
function baseRate(relation) {
  let same = 0, all = 0;
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) { all++; if (items[a].labels[relation] === items[b].labels[relation]) same++; }
  return same / all;
}
function score(edges) {
  const sound = edges.filter(e => e.kind === 'similar');
  const linked = new Set(sound.flatMap(e => [e.source, e.target]));
  const row = { links: sound.length, linkedClips: linked.size / items.length };
  for (const r of relations) row[r] = sound.length ? sound.filter(e => label[e.source][r] === label[e.target][r]).length / sound.length : NaN;
  return row;
}
const grid = policyArg === 'shipped' ? [SOUND_LINK_POLICY] : policyArg ? [JSON.parse(policyArg)] : [1, 2, 3, 5].flatMap(neighbors => [0, .3, .5, .6, .7, .8].map(floor => ({ ...SOUND_LINK_POLICY, neighbors, floor })));
const rows = [];
for (const center of [false, true]) for (const policy of grid) rows.push({ center, ...policy, ...score(buildMusicEdges(nodes(center), policy)) });
// Nearest-neighbour precision ignores any threshold: how often a clip's single closest clip shares the label.
const nn = {};
for (const center of [false, true]) {
  const vs = items.map(i => { const v = unit(vectors.get(i.id)); return center ? unit(v.map((x, d) => x - mean[d])) : v; });
  for (const r of relations) {
    let hit = 0;
    vs.forEach((v, a) => {
      let best = -2, bi = -1;
      vs.forEach((w, b) => { if (a !== b) { const s = v.reduce((t, x, d) => t + x * w[d], 0); if (s > best) { best = s; bi = b; } } });
      if (items[a].labels[r] === items[bi].labels[r]) hit++;
    });
    nn[`${center ? 'centered' : 'raw'}:${r}`] = hit / vs.length;
  }
}
const pct = x => Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : '–';
console.log(`\n${manifest.kind} (${manifestPath}): ${items.length} clips. Random-pair rate: ${relations.map(r => `${r} ${pct(baseRate(r))}`).join(', ')}. Closest-clip precision: ${Object.entries(nn).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);
console.log(`| centered | neighbors | floor | links | clips linked | ${relations.map(r => `same ${r}`).join(' | ')} |`);
console.log(`|---|---|---|---|---|${relations.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${r.center ? 'yes' : 'no'} | ${r.neighbors} | ${r.floor} | ${r.links} | ${pct(r.linkedClips)} | ${relations.map(x => pct(r[x])).join(' | ')} |`);
if (outPath) writeFileSync(outPath, JSON.stringify({ manifest: manifestPath, clips: items.length, baseRates: Object.fromEntries(relations.map(r => [r, baseRate(r)])), nearest: nn, mean, rows }, null, 1));
