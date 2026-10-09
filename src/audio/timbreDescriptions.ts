import type { TimbreSummary } from './timbre';

/**
 * Plain descriptions of how a recording sounds, from fixed DSP rules (src/audio/timbre.ts), not from a model.
 *
 * These nine words have no trustworthy labelled examples, so no model estimate of them can be accuracy-tested
 * (Chris chose "Rules", 2026-10-09). The panel shows the words as one line ("Sound: warm, smooth"), apart from the
 * tested sound tags, with no score or tier; they never form links,
 * and only an older saved view's character filter (styleTags.ts) still matches them. A word you confirmed on a clip still
 * shows as a confirmed tag. Thresholds are deliberately conservative so most sounds get at most one or two words;
 * they were set on synthetic signals (timbre.test.ts), not tuned against listening labels.
 */
export const RULE_DESCRIBED_LABELS = ['warm', 'airy', 'metallic', 'gritty', 'smooth', 'hollow', 'nasal', 'woody', 'glassy'] as const;
export type TimbreWord = typeof RULE_DESCRIBED_LABELS[number];
const RULE_SET: ReadonlySet<string> = new Set(RULE_DESCRIBED_LABELS);
/** True for the nine character words that come from these rules: model estimates of them are never shown. */
export const isRuleDescribedLabel = (label: string) => RULE_SET.has(label);
/** Most words a recording gets; the list order below decides which win. */
export const MAX_TIMBRE_WORDS = 3;

/** One-line plain-English definition of each word, as measured. */
export const TIMBRE_DEFINITIONS: Record<TimbreWord, string> = {
  gritty: 'flat-topped, clipped-looking waveform with plenty of overtones (distortion)',
  airy: 'clear energy above 8 kHz, and that top octave is noise-like (breath, hiss, air)',
  metallic: 'tonal, with strong partials that do not line up as harmonics, and bright',
  glassy: 'pure tones concentrated between 2 and 8 kHz, with little noise',
  woody: 'short, dry hit whose energy sits between 150 Hz and 2 kHz, with little noise',
  nasal: 'harmonic sound with a resonant peak between 1 and 2.5 kHz',
  hollow: 'steady, full sound with a dip in the 500 Hz–2 kHz mids',
  warm: 'a held tone with most energy between 150 and 600 Hz, almost none above 4 kHz, and little noise',
  smooth: 'steady, clean tone with few overtones: no noise, no clipping, almost nothing above 4 kHz',
};

const above = (t: TimbreSummary, band: number) => t.bands.slice(band).reduce((a, b) => a + b, 0);
// Band indexes in TimbreSummary.bands (TIMBRE_BAND_EDGES): 0 sub 20–150, 1 body 150–600, 2 mid 600–2000,
// 3 presence 2–4 kHz, 4 brightness 4–8 kHz, 5 air 8–16 kHz.
const RULES: Record<TimbreWord, (t: TimbreSummary) => boolean> = {
  // Crest factor ≤ 1.3 (a clean sine is 1.41, real music 3+) means squared-off peaks; richness ≥ 0.25 means overtones across ≥ 5 third-octaves.
  gritty: t => t.crest <= 1.3 && t.richness >= .25,
  // ≥ 10% of the energy above 8 kHz, and spectral flatness there ≥ 0.3 (white noise is about 0.56, a tone near 0).
  airy: t => t.bands[5] >= .1 && t.airFlatness >= .3,
  // Inharmonicity ≥ 0.35 (harmonic tones are under 0.05), still tonal (flatness < 0.1), ≥ 15% of energy above 2 kHz.
  metallic: t => t.inharmonicity >= .35 && t.flatness < .1 && above(t, 3) >= .15,
  // ≥ 50% of the energy at 2–8 kHz, under 10% above 8 kHz, near-pure tones (flatness < 0.05), not clipped.
  glassy: t => t.bands[3] + t.bands[4] >= .5 && t.bands[5] < .1 && t.flatness < .05 && t.crest > 1.3,
  // Dies away fast (median level ≤ 10% of the peak), ≥ 70% of the energy at 150 Hz–2 kHz, ≤ 5% above 4 kHz, not noisy (flatness < 0.2).
  woody: t => t.sustain <= .1 && t.bands[1] + t.bands[2] >= .7 && above(t, 4) <= .05 && t.flatness < .2,
  // A third-octave in 1–2.5 kHz ≥ 8 dB above the median third-octave (300 Hz–6 kHz), on a harmonic (inharmonicity < 0.1), rich (≥ 0.5) sound.
  nasal: t => t.resonanceDb >= 8 && t.richness >= .5 && t.inharmonicity < .1 && t.flatness < .3,
  // The 500 Hz–2 kHz third-octaves sit ≥ 10 dB below both neighbours, on a steady (sustain ≥ 0.5), rich (≥ 0.5), not noisy sound.
  hollow: t => t.scoopDb >= 10 && t.richness >= .5 && t.sustain >= .5 && t.flatness < .3,
  // ≥ 40% of the energy at 150–600 Hz, ≤ 40% below 150 Hz, ≤ 2% above 4 kHz, little noise (flatness < 0.1), not clipped,
  // and a held, harmonic tone (sustain ≥ 0.3, inharmonicity < 0.2) rather than a struck bell or block.
  warm: t => t.bands[1] >= .4 && t.bands[0] <= .4 && above(t, 4) <= .02 && t.flatness < .1 && t.crest > 1.3 && t.sustain >= .3 && t.inharmonicity < .2,
  // Steady (sustain ≥ 0.5), clean (flatness < 0.05, crest > 1.3, inharmonicity < 0.1), few overtones (richness ≤ 0.3,
  // so a buzzy sawtooth is not smooth), < 3% above 4 kHz.
  smooth: t => t.sustain >= .5 && t.flatness < .05 && t.crest > 1.3 && t.inharmonicity < .1 && t.richness <= .3 && above(t, 4) < .03,
};

/** The 0–3 words the rules give this summary, most distinctive first. Old analyses without a summary get none. */
export function timbreDescriptions(t: TimbreSummary | undefined): TimbreWord[] {
  if (!t) return [];
  return (Object.keys(RULES) as TimbreWord[]).filter(word => RULES[word](t)).slice(0, MAX_TIMBRE_WORDS);
}
