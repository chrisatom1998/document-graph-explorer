import type { DocNode } from '../model/types';
import { sanitizeMusicAnalysis, keyName } from './musicTypes';
import { musicNameHints } from './nameHints';
import { DJ_CATALOG } from './djTags';
import { INSTRUMENT_LABELS } from './instrumentLabels';
import { confirmedInstrumentList } from './instrumentEvidence';

export const MAX_COPILOT_SAMPLES = 5;
export interface CopilotSample {
  ref: string;
  durationSeconds: number;
  analyzedSeconds: number;
  preview: boolean;
  tempo: { bpm: number; confidence: number } | null;
  key: { name: string; strength: number } | null;
  confirmedTags: string[] | null;
  confirmedInstruments: string[] | null;
  estimates: { label: string; score: number }[];
  filenameHints: { bpm: number | null; key: string | null };
}
const labels = new Set<string>([...INSTRUMENT_LABELS, ...DJ_CATALOG.map(c => c.label)]);
const finite = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const musicalKey = (v: unknown): v is string => typeof v === 'string' && /^[A-G](?:[#b♯♭])? (?:major|minor)$/.test(v);

/** Build an explicit data boundary: never copy paths, titles, free-text notes or blobs. */
export function copilotEvidence(node: DocNode, index: number): CopilotSample | null {
  const a = sanitizeMusicAnalysis(node.audio);
  if (node.fileType !== 'audio' || !a) return null;
  const hints = musicNameHints(node);
  return {
    ref: `Sample ${index + 1}`, durationSeconds: a.durationSeconds, analyzedSeconds: a.analyzedSeconds,
    preview: a.stage === 'preview', tempo: a.tempo ? { bpm: a.tempo.bpm, confidence: a.tempo.confidence } : null,
    key: a.key ? { name: keyName(a.key), strength: a.key.strength } : null,
    confirmedTags: a.confirmedDjTags === undefined ? null : [...(confirmedInstrumentList(a)??[]),...a.confirmedDjTags.production,...a.confirmedDjTags.character],
    confirmedInstruments: confirmedInstrumentList(a) ?? null,
    estimates: [...(a.soundProfile?.djTags ?? []), ...a.instruments].filter(t => labels.has(t.label)).slice(0, 30).map(t => ({ label: t.label, score: t.score })),
    filenameHints: { bpm: hints.tempo?.value ?? null, key: hints.key?.displayName ?? null },
  };
}

/** Validate at the server, then reconstruct to strip unexpected client properties. */
export function parseCopilotSamples(value: unknown): CopilotSample[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_COPILOT_SAMPLES) throw Error('Choose one to five analyzed sounds.');
  const list = (v: unknown): string[] | null => {
    if (v === null) return null;
    if (!Array.isArray(v) || v.length > 250 || v.some(s => typeof s !== 'string' || !labels.has(s))) throw Error('Invalid sound labels.');
    return [...new Set(v as string[])];
  };
  return value.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw Error('Invalid sample evidence.');
    const v = raw as CopilotSample;
    if (!finite(v.durationSeconds, 86400) || !finite(v.analyzedSeconds, 86400) || typeof v.preview !== 'boolean') throw Error('Invalid sample duration.');
    if (v.tempo !== null && (!v.tempo || !finite(v.tempo.bpm, 300) || !finite(v.tempo.confidence, 1))) throw Error('Invalid tempo evidence.');
    if (v.key !== null && (!v.key || !musicalKey(v.key.name) || !finite(v.key.strength, 1))) throw Error('Invalid key evidence.');
    if (!Array.isArray(v.estimates) || v.estimates.length > 30 || v.estimates.some(t => !t || !labels.has(t.label) || !finite(t.score, 1))) throw Error('Invalid estimates.');
    if (!v.filenameHints || (v.filenameHints.bpm !== null && !finite(v.filenameHints.bpm, 300)) || (v.filenameHints.key !== null && !musicalKey(v.filenameHints.key))) throw Error('Invalid filename hints.');
    return {
      ref: `Sample ${i + 1}`, durationSeconds: v.durationSeconds, analyzedSeconds: v.analyzedSeconds, preview: v.preview,
      tempo: v.tempo ? { bpm: v.tempo.bpm, confidence: v.tempo.confidence } : null,
      key: v.key ? { name: v.key.name, strength: v.key.strength } : null,
      confirmedTags: list(v.confirmedTags), confirmedInstruments: list(v.confirmedInstruments),
      estimates: v.estimates.map(t => ({ label: t.label, score: t.score })),
      filenameHints: { bpm: v.filenameHints.bpm, key: v.filenameHints.key },
    };
  });
}

export function evidenceSummary(s: CopilotSample): string[] {
  const confirmed = [...new Set([...(s.confirmedTags ?? []), ...(s.confirmedInstruments ?? [])])];
  return [
    confirmed.length ? `Confirmed by you: ${confirmed.join(', ')}` : s.confirmedTags !== null || s.confirmedInstruments !== null ? 'Reviewed: no positive labels in the confirmed fields.' : 'Labels have not been confirmed by you.',
    !s.preview && s.tempo && s.tempo.confidence >= 0.5 ? `Measured tempo: ${s.tempo.bpm.toFixed(1)} BPM` : 'Tempo: unknown or low confidence.',
    !s.preview && s.key && s.key.strength >= 0.6 ? `Estimated key: ${s.key.name}` : 'Key: unknown or low confidence.',
    `Analyzed excerpt: ${s.analyzedSeconds.toFixed(1)}s of ${s.durationSeconds.toFixed(1)}s${s.preview ? ' (preview)' : ''}.`,
    ...(s.filenameHints.bpm !== null || s.filenameHints.key ? [`Filename/folder hints only: ${[s.filenameHints.bpm !== null ? `${s.filenameHints.bpm} BPM` : '', s.filenameHints.key].filter(Boolean).join(', ')}`] : []),
  ];
}
