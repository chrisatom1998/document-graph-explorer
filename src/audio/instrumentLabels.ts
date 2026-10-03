/** Exact classes from the bundled AudioSet model; performance techniques and generic Music are excluded. */
const LABELS: Record<string, string> = {
  "Breathing": "breath",
  "Gasp": "breath",
  "Sigh": "breath",
  "Speech": "voice",
  "Singing": "voice",
  "Choir": "voice",
  "Rapping": "voice",
  "Humming": "voice",
  "Plucked string instrument": "plucked string instrument",
  "Guitar": "guitar",
  "Electric guitar": "electric guitar",
  "Bass guitar": "bass guitar",
  "Acoustic guitar": "acoustic guitar",
  "Steel guitar, slide guitar": "steel guitar / slide guitar",
  "Banjo": "banjo",
  "Sitar": "sitar",
  "Mandolin": "mandolin",
  "Zither": "zither",
  "Ukulele": "ukulele",
  "Keyboard (musical)": "keyboard (musical)",
  "Piano": "piano",
  "Electric piano": "electric piano",
  "Organ": "organ",
  "Electronic organ": "electronic organ",
  "Hammond organ": "hammond organ",
  "Synthesizer": "synthesizer",
  "Sampler": "sampler",
  "Harpsichord": "harpsichord",
  "Percussion": "percussion",
  "Drum kit": "drum kit",
  "Drum machine": "drum machine",
  "Drum": "drum",
  "Snare drum": "snare drum",
  "Bass drum": "bass drum",
  "Timpani": "timpani",
  "Tabla": "tabla",
  "Cymbal": "cymbal",
  "Hi-hat": "hi-hat",
  "Wood block": "wood block",
  "Tambourine": "tambourine",
  "Rattle (instrument)": "rattle (instrument)",
  "Maraca": "maraca",
  "Gong": "gong",
  "Tubular bells": "tubular bells",
  "Mallet percussion": "mallet percussion",
  "Marimba, xylophone": "marimba / xylophone",
  "Glockenspiel": "glockenspiel",
  "Vibraphone": "vibraphone",
  "Steelpan": "steelpan",
  "Brass instrument": "brass instrument",
  "French horn": "french horn",
  "Trumpet": "trumpet",
  "Trombone": "trombone",
  "Bowed string instrument": "bowed string instrument",
  "String section": "string section",
  "Violin, fiddle": "violin / fiddle",
  "Cello": "cello",
  "Double bass": "double bass",
  "Wind instrument, woodwind instrument": "wind instrument / woodwind instrument",
  "Flute": "flute",
  "Saxophone": "saxophone",
  "Clarinet": "clarinet",
  "Harp": "harp",
  "Bell": "bell",
  "Jingle bell": "jingle bell",
  "Chime": "chime",
  "Harmonica": "harmonica",
  "Accordion": "accordion",
  "Bagpipes": "bagpipes",
  "Didgeridoo": "didgeridoo",
  "Shofar": "shofar",
  "Theremin": "theremin",
  "Singing bowl": "singing bowl"
};
export const INSTRUMENT_PARENTS: Record<string, string[]> = {
  "electric guitar": [
    "guitar",
    "plucked string instrument"
  ],
  "acoustic guitar": [
    "guitar",
    "plucked string instrument"
  ],
  "steel guitar / slide guitar": [
    "guitar",
    "plucked string instrument"
  ],
  "bass guitar": [
    "guitar",
    "plucked string instrument"
  ],
  "piano": [
    "keyboard (musical)"
  ],
  "electric piano": [
    "piano",
    "keyboard (musical)"
  ],
  "electronic organ": [
    "organ",
    "keyboard (musical)"
  ],
  "hammond organ": [
    "organ",
    "electronic organ",
    "keyboard (musical)"
  ],
  "harpsichord": [
    "keyboard (musical)"
  ],
  "snare drum": [
    "drum",
    "percussion"
  ],
  "bass drum": [
    "drum",
    "percussion"
  ],
  "timpani": [
    "drum",
    "percussion"
  ],
  "tabla": [
    "drum",
    "percussion"
  ],
  "drum kit": [
    "drum",
    "percussion"
  ],
  "hi-hat": [
    "cymbal",
    "percussion"
  ],
  "violin / fiddle": [
    "bowed string instrument",
    "string section"
  ],
  "cello": [
    "bowed string instrument",
    "string section"
  ],
  "double bass": [
    "bowed string instrument",
    "string section"
  ],
  "french horn": [
    "brass instrument"
  ],
  "trumpet": [
    "brass instrument"
  ],
  "trombone": [
    "brass instrument"
  ],
  "flute": [
    "wind instrument / woodwind instrument"
  ],
  "saxophone": [
    "wind instrument / woodwind instrument"
  ],
  "clarinet": [
    "wind instrument / woodwind instrument"
  ],
  "marimba / xylophone": [
    "mallet percussion",
    "percussion"
  ],
  "glockenspiel": [
    "mallet percussion",
    "percussion"
  ],
  "vibraphone": [
    "mallet percussion",
    "percussion"
  ],
  "steelpan": [
    "mallet percussion",
    "percussion"
  ],
  "banjo": [
    "plucked string instrument"
  ],
  "sitar": [
    "plucked string instrument"
  ],
  "mandolin": [
    "plucked string instrument"
  ],
  "zither": [
    "plucked string instrument"
  ],
  "ukulele": [
    "plucked string instrument"
  ],
  "harp": [
    "plucked string instrument"
  ],
  "wood block": [
    "percussion"
  ],
  "tambourine": [
    "percussion"
  ],
  "rattle (instrument)": [
    "percussion"
  ],
  "maraca": [
    "percussion"
  ],
  "gong": [
    "percussion"
  ],
  "tubular bells": [
    "percussion"
  ]
};
const BROAD = new Set(["percussion", "wind instrument / woodwind instrument", "drum", "bell", "plucked string instrument", "guitar", "cymbal", "chime", "mallet percussion", "keyboard (musical)", "brass instrument", "organ", "bowed string instrument", "string section"]);
export function isBroadInstrument(label: string): boolean { return BROAD.has(label); }
export const INSTRUMENT_LABELS = [...new Set(Object.values(LABELS))].sort();
export function instrumentScores(logits: ArrayLike<number>, labels: Record<string, string>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (let i = 0; i < logits.length; i++) {
    const label = LABELS[labels[String(i)]];
    if (!label) continue;
    const score = 1 / (1 + Math.exp(-logits[i]));
    if (Number.isFinite(score)) scores[label] = Math.max(scores[label] ?? 0, score);
  }
  return scores;
}

export interface InstrumentPredictions {
  scores: Record<string, number>;
  musicScore: number;
}

/** Keep the broad music class as context, never as an instrument. */
export function musicScore(logits: ArrayLike<number>, labels: Record<string, string>): number {
  const entry = Object.entries(labels).find(([, label]) => label === 'Music');
  if (!entry) return 0;
  const score = 1 / (1 + Math.exp(-logits[Number(entry[0])]));
  return Number.isFinite(score) ? score : 0;
}
