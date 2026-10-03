import { musicNameHints } from './nameHints';
import { reliableInstruments } from './instrumentEvidence';
import type { DocNode, Edge } from '../model/types';
import { keyName, type MusicAnalysis } from './musicTypes';
export const MUSIC_EDGE_KINDS = ['tempo', 'key', 'instrument'] as const;
const NEIGHBORS_PER_KIND = 6;
function keyRelation(a: NonNullable<MusicAnalysis['key']>, b: NonNullable<MusicAnalysis['key']>): string | null {
  if (a.strength < 0.6 || b.strength < 0.6) return null;
  if (a.tonic === b.tonic && a.mode === b.mode) return 'same estimated key';
  const relative = a.mode === 'major' ? (a.tonic + 9) % 12 === b.tonic : (b.tonic + 9) % 12 === a.tonic;
  if (a.mode !== b.mode && relative) return 'relative major/minor keys';
  if (a.mode === b.mode && [5, 7].includes((a.tonic - b.tonic + 12) % 12)) return 'neighboring keys on the circle of fifths';
  return null;
}
export function musicPairEdges(a: DocNode, b: DocNode): Edge[] {
  if (a.fileType !== 'audio' || b.fileType !== 'audio' || !a.audio || !b.audio || a.id === b.id) return [];
  const [source, target] = [a.id, b.id].sort();
  const edges: Edge[] = [];
  const add = (kind: typeof MUSIC_EDGE_KINDS[number], weight: number, evidence: string) => edges.push({ id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [evidence, 'Musical similarities are not proof of sampling or influence.'] });
  const ah = musicNameHints(a); const bh = musicNameHints(b);
  const sources = (kind: 'tempo' | 'key' | 'instruments') => `Sources: ${ah[kind]?.source ?? 'audio'} and ${bh[kind]?.source ?? 'audio'}. Name tags are not verified audio detections.`;
  const at = ah.tempo ? { bpm: ah.tempo.value, confidence: 1 } : a.audio.tempo;
  const bt = bh.tempo ? { bpm: bh.tempo.value, confidence: 1 } : b.audio.tempo;
  if (at && bt && Math.min(at.confidence, bt.confidence) >= 0.5) {
    const tolerance = Math.max(3, Math.min(at.bpm, bt.bpm) * 0.04);
    const delta = Math.abs(at.bpm - bt.bpm);
    if (delta <= tolerance) add('tempo', 0.7 + 0.3 * (1 - delta / tolerance), `Similar estimated tempo: ${at.bpm.toFixed(1)} and ${bt.bpm.toFixed(1)} BPM (${delta.toFixed(1)} BPM apart).${ah.tempo || bh.tempo ? ` ${sources('tempo')}` : ''}`);
  }
  // A tag is eligible for matching without fabricating a persisted model confidence.
  const ak = ah.key ? { ...ah.key.value, strength: 1 } : a.audio.key;
  const bk = bh.key ? { ...bh.key.value, strength: 1 } : b.audio.key;
  if (ak && bk) {
    const relation = keyRelation(ak, bk);
    if (relation) add('key', relation === 'same estimated key' ? 1 : 0.8, `${ah.key?.displayName ?? keyName(ak)} and ${bh.key?.displayName ?? keyName(bk)}: ${relation}.${ah.key || bh.key ? ` ${sources('key')}` : ''}`);
  }
  const namedInstruments = (node: DocNode, hints: ReturnType<typeof musicNameHints>) =>
    node.audio!.confirmedInstruments === undefined && !node.audio!.soundReviews?.some(r=>r.dimension==='source') && hints.instruments
      ? hints.instruments.value.map(label => ({ label, score: 1 })) : reliableInstruments(node.audio!);
  const aInstruments = namedInstruments(a, ah);
  const bInstruments = namedInstruments(b, bh);
  const shared = aInstruments.filter(i => bInstruments.some(j => j.label === i.label));
  if (shared.length) {
    const humanA = a.audio.confirmedInstruments !== undefined || a.audio.soundReviews?.some(r=>r.dimension==='source');
    const humanB = b.audio.confirmedInstruments !== undefined || b.audio.soundReviews?.some(r=>r.dimension==='source');
    const hasNameSource = (ah.instruments && !humanA) || (bh.instruments && !humanB);
    const provenance = hasNameSource
      ? `Sources: ${humanA ? 'confirmed by you' : ah.instruments?.source ?? 'audio'} and ${humanB ? 'confirmed by you' : bh.instruments?.source ?? 'audio'}. Name tags are not verified audio detections.`
      : humanA && humanB
      ? 'Confirmed by you on both tracks.'
      : humanA || humanB
        ? 'Confirmed by you on one track; estimated from audio on the other.'
        : 'Supported by strong or repeated audio detections; not confirmed instrumentation.';
    add('instrument', Math.max(...shared.map(i => Math.min(i.score, bInstruments.find(j => j.label === i.label)!.score))), `Shared instruments: ${shared.map(i => i.label).join(', ')}. ${provenance}`);
  }
  return edges;
}
/** Keep the strongest six neighbors per track and relationship type, bounded in memory. */
export function buildMusicEdges(nodes: DocNode[]): Edge[] {
  const audio = nodes.filter(n => n.fileType === 'audio' && n.audio).sort((a,b) => a.id.localeCompare(b.id));
  const best = new Map<string, Edge[]>();
  const keep = (id: string, edge: Edge) => {
    const key = `${id}:${edge.kind}`;const list = best.get(key) ?? [];
    list.push(edge);list.sort((a,b) => b.weight - a.weight || a.id.localeCompare(b.id));list.length = Math.min(list.length, NEIGHBORS_PER_KIND);best.set(key,list);
  };
  for (let i = 0; i < audio.length; i++) for (let j = i + 1; j < audio.length; j++) {
    for (const edge of musicPairEdges(audio[i], audio[j])) { keep(edge.source, edge);keep(edge.target,edge); }
  }
  return [...new Map([...best.values()].flat().map(e=>[e.id,e])).values()];
}
