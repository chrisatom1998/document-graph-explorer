/* Precision and recall of version grouping on the versions test set, through the app's own code:
 * buildVersionEdges (src/audio/versionLinks.ts) builds the links and versionGroup (the track card)
 * groups them. A pair counts as found when the track card of one lists the other, with the right
 * relation: "same recording" for copies, "other version" for remixes of the same song.
 * Groups are split by song into halves A and B; thresholds were chosen on A, so B is the honest number.
 * Usage: npx vite-node scripts/versions/evaluate.ts <manifest.json> <features.jsonl> [out.json] [--pairs pairs.jsonl] */
import { readFileSync, writeFileSync } from 'node:fs';
import type { DocNode } from '../../src/model/types';
import { buildVersionEdges, titleRelation, versionTitle, versionWorkPending } from '../../src/audio/versionLinks';
import { compareVersionPrints, decodeVersionPrint } from '../../src/audio/versionPrint';
import { versionGroup } from '../../src/ui/TrackVersions';

const args = process.argv.slice(2);
const pairsOut = args.includes('--pairs') ? args[args.indexOf('--pairs') + 1] : undefined;
const [MANIFEST, FEATURES, OUT] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--pairs');
type File = { id: string; name: string; recording: string; song: string; origin: string; duration: number };
const files = (JSON.parse(readFileSync(MANIFEST, 'utf8')).files as File[]);
const features = new Map(readFileSync(FEATURES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(f => [f.id, f]));
const usable = files.filter(f => features.has(f.id));
const songs = [...new Set(usable.map(f => f.song))].sort();
const half = (f: File) => songs.indexOf(f.song) % 2 ? 'B' : 'A';

function nodes(withNames: boolean, withPrints = true): DocNode[] {
  return usable.map((f, i) => {
    const x = features.get(f.id);
    const title = withNames ? f.name : `track-${String(i).padStart(3, '0')}.${f.name.split('.').pop()}`;
    return { id: f.id, kind: 'document', title, path: title, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok',
      audio: { version: 2, analyzedSeconds: 0, durationSeconds: x.duration, instruments: [], notes: [], ...(x.embedding ? { embedding: x.embedding } : {}), ...(withPrints && x.print ? { versionPrint: x.print } : {}) } } as DocNode;
  });
}
const truth = (a: File, b: File) => a.recording === b.recording ? 'duplicate' : a.song === b.song ? 'remix' : undefined;

function score(label: string, graph: DocNode[]) {
  // Rebuild until no alignment work is left over, as the app does; record the time to the complete graph.
  const started = Date.now();
  let edges = buildVersionEdges(graph), rebuilds = 1;
  const firstMs = Date.now() - started;
  while (versionWorkPending()) { edges = buildVersionEdges(graph); rebuilds++; }
  const ms = Date.now() - started;
  const result: Record<string, unknown> = { label, edges: edges.length, buildMs: ms, firstBuildMs: firstMs, rebuilds };
  for (const part of ['A', 'B', 'all'] as const) {
    const counts = { duplicate: { tp: 0, fp: 0, fn: 0 }, remix: { tp: 0, fp: 0, fn: 0 }, any: { tp: 0, fp: 0, fn: 0 } };
    const errors: string[] = [];
    for (const a of usable) {
      if (part !== 'all' && half(a) !== part) continue;
      const shown = new Map(versionGroup(a.id, graph, edges).map(m => [m.node.id, m.relation]));
      for (const b of usable) {
        if (b.id <= a.id) continue;
        const want = truth(a, b), got = shown.get(b.id);
        if (want && got) counts.any.tp++; else if (got) counts.any.fp++; else if (want) counts.any.fn++;
        for (const kind of ['duplicate', 'remix'] as const) {
          if (want === kind && got === kind) counts[kind].tp++;
          else if (got === kind) { counts[kind].fp++; if (errors.length < 400) errors.push(`false ${kind}: ${a.id} ~ ${b.id} (truth: ${want ?? 'unrelated'})`); }
          else if (want === kind) { counts[kind].fn++; if (errors.length < 400) errors.push(`missed ${kind}: ${a.id} ~ ${b.id} (shown as ${got ?? 'unrelated'})`); }
        }
      }
    }
    const metrics = Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, { ...c, precision: +(c.tp / Math.max(1, c.tp + c.fp)).toFixed(3), recall: +(c.tp / Math.max(1, c.tp + c.fn)).toFixed(3) }]));
    result[part] = metrics;
    if (part === 'all') result.errors = errors;
    if (part === 'all') result.byTransform = byTransform(graph, edges);
  }
  console.log(`${label}: ${edges.length} links in ${ms} ms (${rebuilds} rebuilds, first ${firstMs} ms)`);
  console.log('  by transform', JSON.stringify(result.byTransform));
  for (const part of ['A', 'B', 'all']) {
    const m = result[part] as Record<string, { precision: number; recall: number; tp: number; fp: number; fn: number }>;
    console.log(`  ${part.padEnd(3)} duplicates P ${m.duplicate.precision} R ${m.duplicate.recall} (${m.duplicate.tp}/${m.duplicate.tp + m.duplicate.fn})   remixes P ${m.remix.precision} R ${m.remix.recall} (${m.remix.tp}/${m.remix.tp + m.remix.fn})   any version P ${m.any.precision} R ${m.any.recall}`);
  }
  return result;
}

/** Duplicate recall for each original-to-copy transform, songs and loops apart (copies are named source~transform). */
function byTransform(graph: DocNode[], edges: ReturnType<typeof buildVersionEdges>) {
  const tally: Record<string, { found: number; total: number }> = {};
  for (const b of usable) {
    const [source, transform] = b.id.split('~');
    if (!transform || !usable.some(a => a.id === source)) continue;
    const key = `${source.startsWith('loop-') ? 'loop' : 'song'} ${transform}`;
    const shown = versionGroup(source, graph, edges).find(m => m.node.id === b.id)?.relation === 'duplicate';
    tally[key] = { found: (tally[key]?.found ?? 0) + +shown, total: (tally[key]?.total ?? 0) + 1 };
  }
  return Object.fromEntries(Object.entries(tally).sort().map(([k, v]) => [k, `${v.found}/${v.total}`]));
}

function titleFacts(x: string, y: string) {
  const a = versionTitle({ title: x }), b = versionTitle({ title: y });
  return { title: titleRelation(a, b) ?? 'none', marked: a.marked || b.marked, sameArtist: !!a.artist && a.artist === b.artist };
}
if (pairsOut) {
  // Raw numbers for every truly related pair and every unrelated pair that shares a song half: used to choose thresholds on half A.
  const decoded = new Map(usable.map(f => [f.id, features.get(f.id).print ? decodeVersionPrint(features.get(f.id).print) : undefined]));
  const lines: string[] = [];
  for (const a of usable) for (const b of usable) {
    if (b.id <= a.id) continue;
    const want = truth(a, b);
    if (!want && (Math.random() > .15)) continue; // a sample of unrelated pairs is enough for threshold plots
    const pa = decoded.get(a.id), pb = decoded.get(b.id);
    const c = pa && pb ? compareVersionPrints(pa, pb) : undefined;
    const va = features.get(a.id).embedding, vb = features.get(b.id).embedding;
    const cosine = va && vb ? va.reduce((s: number, v: number, i: number) => s + v * vb[i], 0) : undefined;
    lines.push(JSON.stringify({ a: a.id, b: b.id, half: half(a) === half(b) ? half(a) : 'mixed', truth: want ?? 'none', ...titleFacts(a.name, b.name), cosine, ...c }));
  }
  writeFileSync(pairsOut, lines.join('\n') + '\n');
  console.log(`${lines.length} pairs written`);
} else {
  const results = [score('names + audio', nodes(true)), score('audio only (names hidden)', nodes(false)), score('names + sound fingerprint only (no prints, older analyses)', nodes(true, false))];
  if (OUT) writeFileSync(OUT, JSON.stringify({ files: usable.length, songs: songs.length, results }, null, 1));
}
