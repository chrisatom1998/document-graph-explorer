import { DJ_CATALOG, mergedDjLabel, type DjGroup } from './djTags';

/** Words sample packs put in file and folder names, mapped to sound tags (Loopcloud / Atlas style: read the name first).
 *
 * Built from the catalog labels and aliases (djCatalog.json) plus the pack spellings below. The spellings come from
 * reports/idea-filename-2026-10-11 (scripts/filename_lexicon.py), written before any test clip was looked at, then pruned
 * by precision on FSD50K *dev* titles (training data; PRUNED below), and from the pack-term survey in
 * reports/dj-terms-2026-11-02. Never tuned on a test set. Name tags are display only: never audio evidence or training truth. */
const PACK: Record<string, string[]> = {
  kick: ['kik', 'kck', 'bd', 'bassdrum', 'kickdrum', 'kicks'],
  snare: ['snr', 'sd', 'snre'],
  clap: ['clp', 'handclap', 'handclaps'],
  'hi-hat': ['hh', 'hat', 'hats', 'hihat', 'hihats', 'hi hat'],
  'closed hi-hat': ['chh', 'clhat', 'closedhat', 'cl hat', 'chat', 'closed hh', 'hh closed', 'hat closed'],
  'open hi-hat': ['ohh', 'ophat', 'openhat', 'op hat', 'ohat', 'open hh', 'hh open', 'hat open'],
  'crash cymbal': ['crsh'],
  'ride cymbal': ['ride cym'],
  cymbal: ['cym', 'cymbals'],
  tom: ['toms', 'floor tom', 'hi tom', 'lo tom', 'mid tom'],
  rimshot: ['rimshot', 'rim shot', 'sidestick', 'side stick'],
  percussion: ['perc', 'percs', 'percussion'],
  'percussion hit': ['perc hit', 'perc one shot'],
  'percussion loop': ['perc loop', 'percussion loop'],
  'drum loop': ['drumloop', 'drum loop', 'drums loop', 'beat loop', 'drumbeat'],
  drums: ['drumkit', 'drum kit'],
  shaker: ['shk', 'shakers'],
  tambourine: ['tamb', 'tambo', 'tamborine'],
  conga: ['congas'], bongo: ['bongos'],
  'finger snap': ['fingersnap', 'finger snaps'],
  breakbeat: ['breakbeat', 'breaks', 'amen'],
  'drum fill': ['fills', 'drumfill'],
  'top loop': ['top', 'tops'],
  synthesizer: ['syn', 'synths', 'synthesiser', 'synthesizer'],
  'synth bass': ['synthbass', 'synbass', 'synth bass'],
  'sub bass': ['subbass', 'sub bass'],
  'reese bass': ['reese'],
  'wobble bass': ['wob', 'wobble'],
  'atmospheric pad': ['pads', 'atmos pad'],
  'synth lead': ['leads', 'ld'],
  'synth arpeggio': ['arps', 'arpeggiated', 'arpeggios'],
  'synth pluck': ['plucks', 'plk'],
  'synth stab': ['stabs'],
  'synth chord': ['chords synth'],
  voice: ['vocal', 'voc', 'vocals', 'vox', 'singing', 'singer', 'sung'],
  'spoken phrase': ['speech', 'spoken', 'talking', 'talk', 'narration', 'speaking'],
  'vocal laugh': ['laugh', 'laughs', 'laughing', 'giggle'],
  'vocal scream': ['screams', 'screaming'],
  'vocal shout': ['shouting', 'shouts', 'yelling'],
  whisper: ['whispers', 'whispering'],
  'vocal hum': ['hum', 'humming'],
  choir: ['choir', 'choirs', 'chorale'],
  breath: ['breath', 'breaths', 'breathe', 'inhale', 'exhale'],
  riser: ['rise', 'riser', 'risers', 'uplift', 'uplifter', 'build up', 'buildup'],
  downlifter: ['downlift', 'downlifters', 'downer', 'downers'],
  impact: ['impacts', 'boom'],
  whoosh: ['whooshes', 'woosh', 'swish'],
  'noise sweep': ['sweeps'],
  'reverse cymbal': ['reverse crash', 'rev crash', 'reverse cym', 'rev cym'],
  'reverse effect': ['rev', 'reversed'],
  'vinyl scratch': ['scratches', 'scratching', 'scr'],
  'vinyl crackle': ['vinyl noise', 'crackles'],
  'sound effect': ['fx', 'sfx', 'effect', 'effects'],
  laser: ['lazer', 'lasers', 'zaps'],
  siren: ['sirens'],
  'air horn': ['air horn', 'airhorn', 'horn blast'],
  'crowd ambience': ['crowds', 'audience', 'cheering', 'applause'],
  'rain ambience': ['raining', 'rainfall', 'drizzle'],
  'wind ambience': ['gust', 'gusts'],
  'water ambience': ['stream', 'river', 'waves', 'ocean', 'brook'],
  'machine ambience': ['machinery', 'motor', 'engine', 'factory'],
  foley: ['foley'],
  'environmental sound': ['atmos', 'atmosphere', 'field recording', 'fieldrecording'],
  'animal sound': ['animal', 'animals', 'dog', 'cat', 'cow', 'horse', 'bark', 'meow', 'frog', 'insect', 'cricket'],
  'electric piano': ['epiano', 'e piano', 'ep', 'wurli', 'wurlitzer', 'rhodes'],
  piano: ['pno', 'pianos', 'grand piano'],
  organ: ['organs', 'hammond'],
  'electric guitar': ['egtr', 'e gtr', 'elec guitar', 'electric gtr', 'dist guitar'],
  'acoustic guitar': ['agtr', 'a gtr', 'acoustic gtr', 'ac guitar', 'nylon guitar', 'steel string'],
  guitar: ['gtr', 'guitars', 'guit', 'gt'],
  'bass guitar': ['electric bass', 'e bass', 'ebass', 'slap bass', 'fingered bass', 'finger bass', 'picked bass', 'jazz bass'],
  'double bass': ['upright bass', 'contrabass', 'doublebass'],
  strings: ['strs', 'orchestral strings', 'string section'],
  'violin / fiddle': ['violins', 'vln', 'vn'],
  viola: ['violas', 'vla'],
  cello: ['cellos', 'vc', 'vlc'],
  trumpet: ['trumpets', 'tpt', 'trp'],
  trombone: ['trombones', 'tbn', 'tbone'],
  saxophone: ['sax', 'saxes', 'alto sax', 'tenor sax', 'altosax', 'tenorsax'],
  flute: ['flutes', 'fl'],
  clarinet: ['clarinets', 'bbclarinet', 'clar'],
  horn: ['french horn', 'frenchhorn', 'horns'],
  tuba: ['tubas'],
  bell: ['bells', 'chimes', 'wind chime', 'wind chimes', 'windchime', 'windchimes'],
  glockenspiel: ['glock'],
  vibraphone: ['vibes', 'vibe', 'vib'],
  xylophone: ['xylo'],
  marimba: ['marimbas'],
  'steel drum': ['steelpan', 'steel pan', 'steeldrum', 'pan drum'],
  gong: ['gongs', 'tam tam', 'tamtam'],
  harp: ['harps'],
  ukulele: ['uke'],
  whistle: ['whistling', 'whistles'],
  harmonica: ['harp blues'],
  accordion: ['accordian'],
  kalimba: ['mbira'],
  gritty: ['dirty'],
};
/** Phrase|tag pairs under 0.5 precision on FSD50K dev titles (reports/idea-filename-2026-10-11/lexicon-drop.json). Kept
 * here, rather than just deleted above, because several are catalog aliases ("string" for strings, "bird" for bird ambience). */
const PRUNED = new Set(['ambience|environmental sound', 'ambient|environmental sound', 'amb|environmental sound', 'bass drum|kick',
  'birds|bird ambience', 'bird|bird ambience', 'chime|bell', 'chirp|bird ambience', 'drums|drums', 'drum|drums', 'foley|foley',
  'machine|machine ambience', 'snapping|finger snap', 'snaps|finger snap', 'strings|strings', 'string|strings', 'str|strings',
  'water|water ambience', 'windy|wind ambience']);

/** "PO_KickHatPerc130-01.wav" -> po kick hat perc 130 01: camelCase and letter/digit boundaries split, extension dropped. */
export function nameTokens(name: string): string[] {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
const phrase = (text: string) => nameTokens(text).join(' ');

interface Lexicon { entries: Map<string, { group: DjGroup; label: string }[]>; longest: number; singular: Set<string> }
const lexicons = new Map<boolean, Lexicon>();
/** catalogOnly: just catalog labels and aliases, the vocabulary the app used before pack spellings (kept for full songs). */
function lexicon(catalogOnly: boolean): Lexicon {
  const cached = lexicons.get(catalogOnly);
  if (cached) return cached;
  const entries = new Map<string, { group: DjGroup; label: string }[]>();
  const add = (words: string, group: DjGroup, label: string) => {
    const key = phrase(words);
    if (!/[a-z]/.test(key) || PRUNED.has(`${key}|${label}`)) return;
    // Merged look-alike tags (MERGED_DJ_LABELS) read under their surviving name and group.
    const target = mergedDjLabel(group, label), list = entries.get(key) ?? [];
    if (!list.some(t => t.group === target.group && t.label === target.label)) entries.set(key, [...list, target]);
  };
  for (const c of DJ_CATALOG) for (const words of [c.label, ...c.aliases]) add(words, c.group as DjGroup, c.label);
  if (!catalogOnly) for (const [label, words] of Object.entries(PACK)) {
    const c = DJ_CATALOG.find(item => item.label === label);
    if (c) for (const w of words) add(w, c.group as DjGroup, c.label);
  }
  const keys = [...entries.keys()];
  const built = { entries, longest: Math.max(...keys.map(k => k.split(' ').length)), singular: new Set(keys.filter(k => !k.includes(' '))) };
  lexicons.set(catalogOnly, built);
  return built;
}

export interface NameMatch { group: DjGroup; label: string; word: string }
/** Every tag one name (a file name or a single folder name) names: longest phrase first, phrases never overlap, and a
 * trailing plural "s" is dropped when only the singular is known ("Claps" -> clap; never "bass"). */
export function nameMatches(name: string, { catalogOnly = false } = {}): NameMatch[] {
  const lx = lexicon(catalogOnly);
  const tokens = nameTokens(name).map(t => t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !lx.singular.has(t) && lx.singular.has(t.slice(0, -1)) ? t.slice(0, -1) : t);
  const out: NameMatch[] = [];
  for (let i = 0; i < tokens.length;) {
    let step = 1;
    for (let n = Math.min(lx.longest, tokens.length - i); n > 0; n--) {
      const word = tokens.slice(i, i + n).join(' '), tags = lx.entries.get(word);
      if (!tags) continue;
      for (const t of tags) if (!out.some(o => o.group === t.group && o.label === t.label)) out.push({ ...t, word });
      step = n; break;
    }
    i += step;
  }
  return out;
}

/** How many folders above the file are read ("Pack/Drums/Kicks/kick_01.wav" reads Kicks, Drums and Pack). Higher folders
 * are usually drive, user and library names. */
export const NAME_FOLDER_DEPTH = 3;
export interface NamedSound extends NameMatch { from: 'file name' | 'folder name' }
/** Tags from a path: the file name first, then the nearest folders. A folder only adds tags to a group (source, production,
 * character) that neither the file name nor a nearer folder already filled: "Drums/Kicks/Kick_01.wav" is a kick, not drums. */
export function namedSounds(path: string, { folders = true, catalogOnly = false } = {}): NamedSound[] {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  const file = parts.pop() ?? '';
  const levels = [file, ...(folders ? parts.reverse().slice(0, NAME_FOLDER_DEPTH) : [])];
  const out: NamedSound[] = [];
  levels.forEach((name, index) => {
    const filled = new Set(out.map(s => s.group));
    for (const m of nameMatches(name, { catalogOnly })) {
      if (index > 0 && filled.has(m.group)) continue;
      if (!out.some(s => s.group === m.group && s.label === m.label)) out.push({ ...m, from: index === 0 ? 'file name' : 'folder name' });
    }
  });
  return out;
}
