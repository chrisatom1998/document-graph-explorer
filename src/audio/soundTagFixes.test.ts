import { describe, expect, it } from 'vitest';
import { applySoundTagFixes, needsFixChip, sanitizeSoundTagFixes, soundTagFixOptions, soundTagFixState, type SoundTagFix } from './soundTagFixes';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import type { DisplaySound } from './confidentSoundSummary';

const at = '2026-10-31T12:00:00.000Z';
const est = (label: string, extra: Partial<DisplaySound> = {}): DisplaySound => ({ dimension: 'source', label, origin: 'model estimate', scores: [{ model: 'Trained head score', score: .45 }], ...extra });

describe('needsFixChip', () => {
  it('shows only on possible or maybe model estimates', () => {
    expect(needsFixChip(est('piano', { tier: 'possible' }))).toBe(true);
    expect(needsFixChip(est('piano', { tier: 'likely', maybe: true }))).toBe(true);
    expect(needsFixChip(est('piano', { tier: 'possible', uncalibrated: true }))).toBe(true);
    expect(needsFixChip(est('piano', { tier: 'likely' }))).toBe(false);
    expect(needsFixChip({ origin: 'confirmed by you' })).toBe(false);
    expect(needsFixChip({ origin: 'From filename', tier: 'possible' })).toBe(false);
  });
});

describe('sanitizeSoundTagFixes', () => {
  it('keeps valid keep, remove and replace fixes', () => {
    const fixes: SoundTagFix[] = [
      { dimension: 'source', label: 'piano', action: 'keep', at },
      { dimension: 'source', label: 'organ', action: 'remove', at },
      { dimension: 'source', label: 'synthesizer', action: 'replace', to: { dimension: 'source', label: 'piano' }, at },
    ];
    expect(sanitizeSoundTagFixes(JSON.parse(JSON.stringify(fixes)))).toEqual(fixes);
  });
  it('drops unknown labels, actions, dates and self-replacements', () => {
    expect(sanitizeSoundTagFixes([
      { dimension: 'source', label: 'not a sound', action: 'keep', at },
      { dimension: 'source', label: 'piano', action: 'confirm', at },
      { dimension: 'source', label: 'piano', action: 'keep', at: 'yesterday' },
      { dimension: 'nope', label: 'piano', action: 'keep', at },
      { dimension: 'source', label: 'piano', action: 'replace', at },
      { dimension: 'source', label: 'piano', action: 'replace', to: { dimension: 'source', label: 'piano' }, at },
      { dimension: 'source', label: 'piano', action: 'replace', to: { dimension: 'source', label: '???' }, at },
      null, 'piano',
    ])).toEqual([]);
    expect(sanitizeSoundTagFixes('x')).toBeUndefined();
  });
  it('survives the stored-analysis round trip', () => {
    const audio: MusicAnalysis = { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
      soundTagFixes: [{ dimension: 'source', label: 'piano', action: 'remove', at }] };
    expect(sanitizeMusicAnalysis(JSON.parse(JSON.stringify(audio)))?.soundTagFixes).toEqual(audio.soundTagFixes);
    expect(sanitizeMusicAnalysis({ ...audio, soundTagFixes: [{ label: 'x' }] })?.soundTagFixes).toBeUndefined();
  });
});

describe('applySoundTagFixes', () => {
  const shown = [est('synthesizer', { tier: 'possible' }), est('organ', { tier: 'likely', maybe: true }), est('guitar', { tier: 'likely' })];
  it('changes nothing without fixes', () => {
    expect(applySoundTagFixes(shown, undefined)).toEqual(shown);
  });
  it('keep marks the tag as yours, remove hides it, replace swaps in the right tag', () => {
    const out = applySoundTagFixes(shown, [
      { dimension: 'source', label: 'synthesizer', action: 'keep', at },
      { dimension: 'source', label: 'organ', action: 'replace', to: { dimension: 'source', label: 'piano' }, at },
      { dimension: 'source', label: 'guitar', action: 'remove', at },
    ]);
    expect(out).toEqual([
      { dimension: 'source', label: 'synthesizer', origin: 'confirmed by you' },
      { dimension: 'source', label: 'piano', origin: 'confirmed by you' },
    ]);
    expect(out.some(needsFixChip)).toBe(false);
  });
  it('lets the latest fix for a tag win', () => {
    const state = soundTagFixState([
      { dimension: 'source', label: 'organ', action: 'replace', to: { dimension: 'source', label: 'piano' }, at },
      { dimension: 'source', label: 'piano', action: 'remove', at },
      { dimension: 'source', label: 'organ', action: 'keep', at },
    ]);
    expect(state.get('source:piano')?.show).toBe(false);
    expect(state.get('source:organ')?.show).toBe(true);
  });
  it('keeps a picked tag shown even when the model no longer shows it, without duplicating one it does', () => {
    const out = applySoundTagFixes([est('guitar', { tier: 'likely' })], [
      { dimension: 'source', label: 'synthesizer', action: 'replace', to: { dimension: 'source', label: 'guitar' }, at }]);
    expect(out).toEqual([{ dimension: 'source', label: 'guitar', origin: 'confirmed by you' }]);
  });
});

it('offers picker tags grouped by dimension, each valid as a fix', () => {
  const groups = soundTagFixOptions();
  expect(groups.map(g => g.group)).toEqual(['Sound source', 'Sound type', 'Character']);
  for (const g of groups) for (const o of g.options)
    expect(sanitizeSoundTagFixes([{ dimension: 'source', label: 'piano', action: 'replace', to: { dimension: o.dimension, label: o.label }, at }])).toHaveLength(o.dimension === 'source' && o.label === 'piano' ? 0 : 1);
});
