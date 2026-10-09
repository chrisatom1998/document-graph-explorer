import assert from 'node:assert/strict';
import { displayedPredictions } from './displayed-predictions.mjs';

const manifest = { clips: [{ id: 'one', file: 'c000001.wav' }, { id: 'missing', file: 'c000002.wav' }] };
const audio = { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
  recognition: { status: 'complete', mode: 'full', observations: [], evidence: [] },
  soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
    djTags: [{ group: 'production', label: 'kick', score: .45, model: 'Trained head' }] } };
const graph = { nodes: [{ path: 'c000001.wav', audio }], edges: [] };
assert.deepEqual(displayedPredictions(manifest, graph, 'all')[0].labels, ['effect:kick']);
assert.deepEqual(displayedPredictions(manifest, graph, 'likely')[0].labels, []);
assert.equal(displayedPredictions(manifest, graph)[1].status, 'missing');
audio.soundProfile.djTags[0].score = .85;
assert.deepEqual(displayedPredictions(manifest, graph, 'likely')[0].labels, ['effect:kick']);
audio.soundReviews = [{ dimension: 'effect', labelId: 'kick', decision: 'confirmed' }];
assert.throws(() => displayedPredictions(manifest, graph), /blind prediction/);
delete audio.soundReviews;
for (const confirmedInstruments of [[], ['piano']]) {
  audio.confirmedInstruments = confirmedInstruments;
  for (const tier of ['all', 'likely']) {
    assert.throws(() => displayedPredictions(manifest, graph, tier), /blind prediction/);
  }
}
delete audio.confirmedInstruments;
assert.throws(() => displayedPredictions(manifest, { nodes: [...graph.nodes, ...graph.nodes] }), /Ambiguous/);
console.log('Display-policy benchmark checks passed. No audio inference was run.');
