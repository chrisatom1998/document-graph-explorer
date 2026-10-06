// Score stitched-song runs: which OpenMIC instruments each build reports, per output.
// Usage: npx vite-node scripts/score-stitched-songs.mjs <songs.json> <label>=<graph-export.json> [...]
// Target songs: does the part-time target instrument get found? Control songs (no target anywhere):
// does it get reported anyway? tp/fp/fn cover every scorable song label. Outputs, all from the app's own analysis: "possible list" (analysis.instruments), "primary source"
// (soundProfile.source) and "Sounds panel" (confidentSoundSummary). Unknown song labels are never scored.
import { readFileSync } from 'node:fs';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';

// Same runtime -> OpenMIC mapping as scripts/openmic-pilot.py (RUNTIME_LABEL_MAPPING).
const MAPPING = { accordion: ['accordion'], banjo: ['banjo'], cello: ['cello'], clarinet: ['clarinet'], flute: ['flute'], mandolin: ['mandolin'], saxophone: ['saxophone'], synthesizer: ['synthesizer'], trombone: ['trombone'], trumpet: ['trumpet'], ukulele: ['ukulele'], voice: ['voice'], bass: ['bass guitar', 'double bass'], cymbals: ['cymbal', 'hi-hat'], drums: ['drum', 'drum kit', 'drum machine', 'snare drum', 'bass drum', 'timpani', 'tom-tom'], mallet_percussion: ['mallet percussion', 'marimba / xylophone', 'vibraphone', 'glockenspiel'], violin: ['violin / fiddle'], guitar: ['guitar', 'electric guitar', 'acoustic guitar', 'steel guitar / slide guitar'], piano: ['piano', 'electric piano'], organ: ['organ', 'electronic organ', 'hammond organ'] };
const toClasses = labels => Object.entries(MAPPING).filter(([, aliases]) => labels.some(l => aliases.includes(l))).map(([c]) => c);
const [songsPath, ...runs] = process.argv.slice(2);
const { songs } = JSON.parse(readFileSync(songsPath, 'utf8'));
const outputs = {
  'possible list': a => a.instruments.map(i => i.label),
  'primary source': a => a.soundProfile?.source ? [a.soundProfile.source.label] : [],
  'Sounds panel': a => confidentSoundSummary(a).filter(s => s.dimension === 'source').map(s => s.label),
};
const report = {};
for (const run of runs) {
  const [label, path] = run.split('=');
  const nodes = JSON.parse(readFileSync(path, 'utf8')).nodes;
  const byId = new Map(nodes.map(n => [String(n.path ?? n.title).replace(/\.wav$/, ''), n.audio]));
  report[label] = { analysed: songs.filter(s => byId.get(s.id)?.recognition?.status === 'complete').length, songs: songs.length };
  for (const [name, read] of Object.entries(outputs)) {
    const t = { targetFound: 0, targets: 0, controlAlarms: 0, controls: 0, tp: 0, fp: 0, fn: 0, falseAlarms: [] };
    for (const song of songs) {
      const audio = byId.get(song.id);
      const predicted = new Set(audio ? toClasses(read(audio)) : []);
      if (song.kind === 'target') { t.targets++; if (predicted.has(song.target)) t.targetFound++; }
      else { t.controls++; if (predicted.has(song.target)) t.controlAlarms++; }
      for (const [c, state] of Object.entries(song.labels)) {
        if (state === 'present') { if (predicted.has(c)) t.tp++; else t.fn++; }
        else if (state === 'absent' && predicted.has(c)) { t.fp++; t.falseAlarms.push(`${song.id}:${c}`); }
      }
    }
    const precision = t.tp + t.fp ? t.tp / (t.tp + t.fp) : null, recall = t.tp + t.fn ? t.tp / (t.tp + t.fn) : null;
    report[label][name] = { ...t, precision, recall, absentLabels: songs.reduce((n, s) => n + Object.values(s.labels).filter(v => v === 'absent').length, 0) };
  }
}
console.log(JSON.stringify(report, null, 1));
