export interface SamplePack {
  id: string; name: string; publisher: string; url: string; licenseUrl: string;
  tags: string[]; description: string; access: string; checked: string;
}
/** Publisher pages checked on this date; these are starting sources, not live search results. */
export const SAMPLE_PACKS: SamplePack[] = [
  { id: 'freepats-synth', name: 'Synthesizer Percussion', publisher: 'FreePats',
    url: 'https://freepats.zenvoid.org/Percussion/electric-percussion.html', licenseUrl: 'https://freepats.zenvoid.org/Percussion/electric-percussion.html',
    tags: ['drums', 'synth', 'electronic', 'percussion', 'one shots'], description: 'Synthesized vintage-style drum sounds. Choose SFZ WAV and extract the audio files.', access: 'Free download · WAV archive about 1.8 MiB', checked: '2026-10-02' },
  { id: 'freepats-world', name: 'World and Rare Percussion', publisher: 'FreePats',
    url: 'https://freepats.zenvoid.org/Percussion/world-and-rare-percussion.html', licenseUrl: 'https://freepats.zenvoid.org/Percussion/world-and-rare-percussion.html',
    tags: ['drums', 'acoustic', 'percussion', 'clap', 'bongos', 'shaker'], description: 'Recorded percussion including bongos, shakers, claps, conga and cajón. Useful instrument examples.', access: 'Free download · WAV archive about 8.3 MiB', checked: '2026-10-02' },
  { id: 'vcsl', name: 'Versilian Community Sample Library', publisher: 'Versilian Studios',
    url: 'https://github.com/sgossner/VCSL', licenseUrl: 'https://github.com/sgossner/VCSL/blob/master/LICENSE',
    tags: ['instruments', 'acoustic', 'synth', 'percussion', 'strings', 'wind', 'one shots'], description: 'Broad instrument recordings organized by instrument and articulation. Select the instruments you need from the repository or releases.', access: 'Free download · library size varies', checked: '2026-10-02' },
  { id: 'kenney-impact', name: 'Impact Sounds', publisher: 'Kenney',
    url: 'https://kenney.nl/assets/impact-sounds', licenseUrl: 'https://kenney.nl/assets/impact-sounds',
    tags: ['foley', 'impacts', 'effects', 'percussion', 'controls'], description: '130 impact and foley sounds. Useful non-musical controls to test false instrument detections.', access: 'Free download · donation optional', checked: '2026-10-02' },
];
export function findSamplePacks(query: string): SamplePack[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return SAMPLE_PACKS.filter(pack => terms.every(term => [pack.name, pack.publisher, pack.description, ...pack.tags].join(' ').toLowerCase().includes(term)));
}
export function publicSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
