import { describe, expect, it } from 'vitest';
import model from './genreEnergyModel.json';
import fixture from './genreEnergy.fixture.json';
import { ENERGY_KEY, GENRE_ENERGY_VERSION, GENRE_LABELS, GenreEnergyScores, STYLE_PREFIX, energyFromScore, genreFromScores, genreProbabilities, genreText, sanitizeGenreScores } from './genreEnergy';
import { jamendoInstrumentScores } from './jamendo';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import { musicPairEdges } from './musicLinks';
import type { DocNode } from '../model/types';

const scoresFor = (label: string, value: number) => Object.fromEntries(model.genre.classes.map(c => [c, c === label ? value : (1 - value) / (model.genre.classes.length - 1)]));

describe('genre and energy', () => {
  it('averages styles over windows and energy as a mean logit', () => {
    const acc = new GenreEnergyScores()
      .add({ [`${STYLE_PREFIX}Electronic---Techno`]: .8, [ENERGY_KEY]: .9, piano: .7 })
      .add({ [`${STYLE_PREFIX}Electronic---Techno`]: .4, [ENERGY_KEY]: .5 });
    expect(acc.styleList()).toEqual([{ label: 'Electronic---Techno', score: .6 }]);
    // logit(.9) = 2.197, logit(.5) = 0: mean 1.099 -> 0.75.
    expect(acc.energyScore()).toBeCloseTo(.75, 3);
    expect(Object.keys(acc.genreScores()).sort()).toEqual([...model.genre.classes].sort());
  });

  it('keeps style and energy keys out of the instrument scores the fusion scorer reads', () => {
    expect(jamendoInstrumentScores({ piano: .5, [`${STYLE_PREFIX}Rock---Punk`]: .2, [ENERGY_KEY]: .7, 'nsynth:reverb:wet': .9 })).toEqual({ piano: .5 });
  });

  it('turns style scores into genre probabilities that sum to one', () => {
    // Real tuning tracks' mean style scores (EffnetDiscogs order); the head must name their Beatport genre.
    for (const track of fixture) {
      const p = genreProbabilities(new Map(model.genre.styles.map((label, i) => [label, track.styles[i]])));
      expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
      expect(Object.entries(p).sort((a, b) => b[1] - a[1])[0][0]).toBe(track.genre);
    }
  });

  it('shows a genre over its threshold, a family when only the family is clear, and nothing otherwise', () => {
    const k = model.genre.thresholds.findIndex(t => t <= 1);
    const genre = model.genre.classes[k];
    expect(genreFromScores(scoresFor(genre, Math.min(.99, model.genre.thresholds[k] + .01)))?.label).toBe(genre);
    const family = model.genre.families.find(f => f.threshold <= 1 && f.members.every(m => model.genre.thresholds[model.genre.classes.indexOf(m)] > 1));
    if (family) {
      const split = Object.fromEntries(model.genre.classes.map(c => [c, family.members.includes(c) ? Math.min(.99, family.threshold + .05) / family.members.length : 0]));
      expect(genreFromScores(split)?.label).toBe(family.label);
    }
    expect(genreFromScores(Object.fromEntries(model.genre.classes.map(c => [c, .01])))).toBeUndefined();
    expect(GENRE_LABELS).toContain(genre);
  });

  it('maps the energy score to low, medium and high', () => {
    expect(energyFromScore(model.energy.high)?.level).toBe('high');
    expect(energyFromScore(model.energy.low)?.level).toBe('low');
    expect(energyFromScore((model.energy.low + model.energy.high) / 2)).toMatchObject({ level: 'medium', tested: false });
    expect(energyFromScore(undefined)).toBeUndefined();
    expect(energyFromScore(2)).toBeUndefined();
  });

  it('drops saved genre scores from another head version', () => {
    expect(sanitizeGenreScores({ version: 'old', scores: { techno: .5 } })).toBeUndefined();
    expect(sanitizeGenreScores({ version: GENRE_ENERGY_VERSION, scores: { [model.genre.classes[0]]: .5, made_up: .4 } })?.scores).toEqual({ [model.genre.classes[0]]: .5 });
  });

  it('round-trips through saved analysis', () => {
    const raw = { version: 2, analyzedSeconds: 10, durationSeconds: 10, instruments: [], notes: [],
      styles: [{ label: 'Electronic---Techno', score: .5 }, { label: 'x', score: 3 }], genreScores: { version: GENRE_ENERGY_VERSION, scores: { [model.genre.classes[0]]: .7 } }, energyScore: .8 };
    const out = sanitizeMusicAnalysis(raw)!;
    expect(out.styles).toEqual([{ label: 'Electronic---Techno', score: .5 }]);
    expect(out.genreScores?.scores).toEqual({ [model.genre.classes[0]]: .7 });
    expect(out.energyScore).toBe(.8);
    expect(sanitizeMusicAnalysis({ ...raw, energyScore: -1 })!.energyScore).toBeUndefined();
  });

  it('links two tracks of the same estimated genre', () => {
    const k = model.genre.thresholds.findIndex(t => t <= 1);
    const genre = model.genre.classes[k];
    const node = (id: string): DocNode => ({ id, kind: 'document', fileType: 'audio', title: `${id}.wav`, topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
      audio: { version: 2, durationSeconds: 120, analyzedSeconds: 120, instruments: [], notes: [], genreScores: { version: GENRE_ENERGY_VERSION, scores: scoresFor(genre, .95) } } as MusicAnalysis });
    const edges = musicPairEdges(node('a'), node('b'));
    const edge = edges.find(e => e.kind === 'genre');
    expect(edge?.evidence[0]).toContain(`Same estimated genre: ${genreText(genre)}`);
    const preview = node('c'); preview.audio!.stage = 'preview';
    expect(musicPairEdges(node('a'), preview).some(e => e.kind === 'genre')).toBe(false);
  });
});
