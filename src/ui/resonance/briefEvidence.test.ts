import { describe, expect, it } from 'vitest';
import type { Edge, EdgeKind } from '../../model/types';
import { briefEvidence } from './briefEvidence';

const edge = (kind: EdgeKind, evidence: string): Edge => ({ id: kind, source: 'a', target: 'b', kind, weight: 0.6, evidence: [evidence] });

describe('briefEvidence', () => {
  it('reduces name-based tempo and key links to their source', () => {
    expect(briefEvidence(edge('tempo', 'Similar estimated tempo: 140.0 and 140.0 BPM (0.0 BPM apart). Sources: file name and file name. Name tags are not verified audio detections.'))).toBe('from file names');
    expect(briefEvidence(edge('key', 'Harmonic key relation: D minor and D minor: same estimated key. Sources: file name and file name. Name tags are not verified audio detections. This does not establish similar sound or mix quality.'))).toBe('from file names');
  });

  it('keeps a non-trivial key relation and audio-only tempo', () => {
    expect(briefEvidence(edge('key', 'Harmonic key relation: A minor and C major: relative major/minor. Based on audio estimates.'))).toBe('relative major/minor · measured from audio');
    expect(briefEvidence(edge('tempo', 'Half/double-time tempo: 70.0 and 140.0 BPM (0.0 BPM apart after doubling 70.0). Related pulse rates, not the same measured tempo. Based on audio estimates.'))).toBe('half / double time · measured from audio');
  });

  it('lists shared instruments and sounds without per-label provenance', () => {
    expect(briefEvidence(edge('instrument', 'Shared instruments: synthesizer. Not confirmed instrumentation. synthesizer: model estimate / model estimate. Includes source labels from the Sounds / Other model guesses lists, which are model estimates or untested guesses.'))).toBe('synthesizer · model guess');
    expect(briefEvidence(edge('sound', 'Shared sound properties: rhythmic (character), pulsing (character), warm (character). Not confirmed by you on at least one track (rhythmic: maybe-level model estimate / maybe-level model estimate). Matches the Sounds and Other model guesses lists.'))).toBe('rhythmic, pulsing, warm · weak model guess');
    expect(briefEvidence(edge('sound', 'Shared sound properties: riser (production / effect). Confirmed by you on both tracks.'))).toBe('riser · confirmed by you');
  });

  it('summarises fingerprint and title links', () => {
    expect(briefEvidence(edge('similar', "Sounds alike: the two recordings' sound fingerprints are 77% similar. Both also have: drum_loop (production / effect), detected by tested sound models. Similar sound is not proof of an exact duplicate, sampling, a shared source or influence."))).toBe('both have drum loop · sound fingerprint');
    expect(briefEvidence(edge('title', 'Shared title phrase: “loop test”.'))).toBe('“loop test” · from file names');
  });
});
