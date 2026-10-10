import { describe, expect, it } from 'vitest';
import { DJ_CATALOG } from './djTags';
import { stemRoleOf } from './stemRole';

describe('stemRoleOf', () => {
  it('puts producer tags in the stem a DJ would look in', () => {
    expect(['kick', 'top loop', 'conga', 'drums'].map(stemRoleOf)).toEqual(['drums', 'drums', 'drums', 'drums']);
    expect(['808 bass', 'reese bass', 'synth bass', 'bass guitar'].map(stemRoleOf)).toEqual(['bass', 'bass', 'bass', 'bass']);
    expect(['vocal chops', 'voice', 'beatbox'].map(stemRoleOf)).toEqual(['vocals', 'vocals', 'vocals']);
    expect(['synth pluck', 'piano', 'atmospheric pad', 'strings'].map(stemRoleOf)).toEqual(['melody', 'melody', 'melody', 'melody']);
  });
  it('leaves effects, textures and character words out of every stem', () => {
    expect(['riser', 'impact', 'vinyl crackle', 'rain ambience', 'warm', 'reverberant', 'chops'].map(stemRoleOf).filter(Boolean)).toEqual([]);
  });
  it('covers every catalog instrument source, leaving only effects and ambient sources', () => {
    const left = DJ_CATALOG.filter(c => c.family === 'sources' && !stemRoleOf(c.label)).map(c => c.label);
    expect(left.sort()).toEqual(['animal sound', 'environmental sound', 'foley', 'noise', 'singing bowl', 'sound effect', 'turntable', 'waterphone']);
  });
});
