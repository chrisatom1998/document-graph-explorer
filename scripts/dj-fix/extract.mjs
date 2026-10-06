// Per-clip record for offline calibration: what the app showed (with every model score behind each tag), the raw
// native and fusion scores, CLAP trained-head tags, and tempo / key.
// Usage: npx vite-node scripts/dj-fix/extract.mjs <out.json> <graph-export.json>...
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';

const [outPath, ...exportPaths] = process.argv.slice(2);
const r4 = (x) => +x.toFixed(4);
const rows = [];
for (const path of exportPaths) for (const node of JSON.parse(readFileSync(path, 'utf8')).nodes) {
  const audio = node.audio;
  if (!audio) continue;
  const native = {};
  for (const e of audio.recognition?.evidence ?? []) {
    const m = (native[e.modelId] ??= {}), k = `${e.dimension}:${e.labelId}`;
    m[k] = Math.max(m[k] ?? 0, r4(e.score));
  }
  const fusion = {};
  for (const w of audio.fusion?.windows ?? []) for (const d of w.decisions) if (d.headProbability !== null) {
    const f = (fusion[d.label] ??= { head: 0, source: d.source, state: d.state });
    if (d.headProbability >= f.head) Object.assign(f, { head: r4(d.headProbability), source: d.source, state: d.state });
  }
  rows.push({ id: (node.path ?? node.title).replace(/\.[^.]+$/, ''), duration: audio.durationSeconds, status: audio.recognition?.status,
    shown: confidentSoundSummary(audio, audio.recognition?.mode).map(s => ({ dimension: s.dimension, label: s.label, maybe: !!s.maybe, tier: s.tier,
      scores: (s.scores ?? []).map(x => ({ model: x.model, score: r4(x.score) })) })),
    djTags: (audio.soundProfile?.djTags ?? []).map(t => ({ group: t.group, label: t.label, model: t.model ?? null, score: typeof t.score === 'number' ? r4(t.score) : null })),
    native, fusion, tempo: audio.tempo ?? null, key: audio.key ?? null });
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips extracted to ${outPath}`);
