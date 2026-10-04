import type { DocNode } from '../model/types';
import { sampleLabels } from './sampleSearch';
import { keyName } from './musicTypes';
import { musicNameHints } from './nameHints';

export function uploadInsight(node: DocNode) {
  const a = node.audio;
  const hints = musicNameHints(node);
  const labels = sampleLabels(node);
  const confirmed = labels.filter(l => l.source === 'confirmed');
  const reasons: string[] = [];
  if (!a || a.stage === 'preview') reasons.push('Initial estimate; deeper checks are still needed.');
  if (!confirmed.length && !labels.length) reasons.push('Sound source is unknown.');
  if (!a?.tempo || a.tempo.confidence < .5) reasons.push('No reliable tempo estimate.');
  if (!a?.key || a.key.strength < .6) reasons.push('No reliable musical key.');
  if (hints.tempo && a?.tempo && a.tempo.confidence >= .5 && Math.abs(hints.tempo.value - a.tempo.bpm) > 4) {
    const ratio = hints.tempo.value / a.tempo.bpm;
    reasons.push(Math.abs(ratio - 2) < .08 || Math.abs(ratio - .5) < .04 ? 'Filename tempo and measured tempo differ by half/double time.' : 'Filename tempo conflicts with the measured estimate.');
  }
  if (hints.key && a?.key && a.key.strength >= .6 && (hints.key.value.tonic !== a.key.tonic || hints.key.value.mode !== a.key.mode)) reasons.push('Filename key differs from the audio estimate.');
  const descriptions = [
    confirmed.length ? `Confirmed: ${confirmed.map(l => l.label).join(', ')}` : labels.length ? `Estimated: ${labels.slice(0, 4).map(l => l.label).join(', ')}` : 'Sound source not identified',
    a?.stage !== 'preview' && a?.tempo && a.tempo.confidence >= .5 ? `${a.tempo.bpm.toFixed(1)} BPM` : 'tempo unconfirmed',
    a?.stage !== 'preview' && a?.key && a.key.strength >= .6 ? keyName(a.key) : 'key unconfirmed',
  ];
  const groups = [...new Set(labels.map(l => `${l.source}: ${l.label}`))].slice(0, 5);
  if (a?.stage !== 'preview' && a?.tempo && a.tempo.confidence >= .5) groups.push(`${Math.floor(a.tempo.bpm / 10) * 10}–${Math.floor(a.tempo.bpm / 10) * 10 + 9} BPM`);
  return { summary: descriptions.join(' · '), reasons, groups, priority: reasons.some(r => /conflicts|differs/.test(r)) ? 2 : reasons.length ? 1 : 0 };
}
