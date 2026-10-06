// Measures the "unverified" raw-CLAP fallback with the app's own selectDjTags: for each label without a tested
// detector, how often it fires (score >= 0.40) and how often the clip's own labels agree. Tags on Freesound are
// incomplete, so agreement is a LOWER bound on precision. Library labels come from file names.
// Usage: npx vite-node scripts/unverified-fallback-cost.mjs <clap-scores-sample.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { selectDjTags } from '../src/audio/djTags';
import { CALIBRATED_LABELS, TRACK_SOUND_FLOOR } from '../src/audio/confidentSoundSummary';
const [IN, OUT] = process.argv.slice(2);
const { prompts, clips } = JSON.parse(readFileSync(IN, 'utf8'));
const stats = {};
for (const pool of ['real', 'library']) {
  const cs = clips.filter(c => c.pool === pool);
  for (const c of cs) {
    const scores = c.scores.map((score, i) => ({ group: prompts[i].group, label: prompts[i].label, score, ...(prompts[i].prompt ? { alternative: prompts[i].prompt } : {}) }));
    for (const t of selectDjTags(scores)) {
      if (t.model !== 'Music CLAP' || t.score < Number(process.env.FLOOR ?? TRACK_SOUND_FLOOR) || CALIBRATED_LABELS.has(t.label)) continue;
      const s = (stats[t.label] ??= { real: { fired: 0, agree: 0, clips: 0 }, library: { fired: 0, agree: 0, clips: 0 } });
      s[pool].fired++; if (c.labels.includes(t.label)) s[pool].agree++;
    }
  }
  for (const s of Object.values(stats)) s[pool].clips = cs.length;
}
const rows = Object.entries(stats).map(([label, s]) => ({ label, ...s })).sort((a, b) => (b.real.fired + b.library.fired) - (a.real.fired + a.library.fired));
writeFileSync(OUT, JSON.stringify({ kind: 'unverified-fallback-cost-v1', clips: { real: clips.filter(c => c.pool === 'real').length, library: clips.filter(c => c.pool === 'library').length }, labels: rows }, null, 1));
for (const r of rows) console.log(`${r.label.padEnd(22)} real fires ${String(r.real.fired).padStart(4)} agree ${String(r.real.agree).padStart(3)}   library fires ${String(r.library.fired).padStart(4)} agree ${String(r.library.agree).padStart(3)}`);
console.log(rows.length, 'uncalibrated labels fired at least once');
