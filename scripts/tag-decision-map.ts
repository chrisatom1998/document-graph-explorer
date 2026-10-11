/* Writes docs/tag-decision-map.md: for every pickable sound tag, the detector whose score the app shows today.
 * Everything in the table is read from the app's own files, so rerun this after changing any of them:
 *   npx vite-node scripts/tag-decision-map.ts            (rewrites the doc)
 *   npx vite-node scripts/tag-decision-map.ts --check    (fails when the doc is out of date; for CI or a pre-commit hook)
 * Inputs: src/audio/djTags.ts (catalog, merged and hidden names), src/audio/taggerPolicy.json, public/sound-model/learned.json,
 * public/sound-model/short-clip.json, public/sound-model/prompts.json, public/tagger-model/model.json and the display lists in
 * src/audio/confidentSoundSummary.ts (calibrated, blocked and hidden-until-tested labels) and src/audio/timbreDescriptions.ts.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DJ_CATALOG, DJ_HIDDEN_LABELS, DJ_PICKER_LABELS, MERGED_DJ_LABELS, soundLabelText, type DjGroup } from '../src/audio/djTags';
import { TAGGER_POLICY } from '../src/audio/tagger';
import { CALIBRATED_LABELS, HIDDEN_UNTIL_TESTED, UNVERIFIED_BLOCKED } from '../src/audio/confidentSoundSummary';
import { SHORT_CLIP_MAX_SECONDS } from '../src/audio/shortClipModel';
import { isRuleDescribedLabel } from '../src/audio/timbreDescriptions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/tag-decision-map.md');
interface Head { group: DjGroup; label: string; threshold: number; maybe?: boolean; oneShot?: boolean }
const learned = JSON.parse(readFileSync(join(ROOT, 'public/sound-model/learned.json'), 'utf8')) as { heads: Head[]; examples: unknown[] };
const shortClip = JSON.parse(readFileSync(join(ROOT, 'public/sound-model/short-clip.json'), 'utf8')) as { heads: Head[] };
const prompts = JSON.parse(readFileSync(join(ROOT, 'public/sound-model/prompts.json'), 'utf8')) as { group: string; label: string | null }[];
const taggerClasses = JSON.parse(readFileSync(join(ROOT, 'public/tagger-model/model.json'), 'utf8')).classes as string[];
let commit = 'unknown'; try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

const GROUP_OF_DIMENSION: Record<string, DjGroup> = { source: 'source', effect: 'production', character: 'character' };
const key = (group: string, label: string) => `${group}:${label}`;
const catalog = new Map(DJ_CATALOG.map(c => [key(c.group, c.label), c]));
/** Surviving name -> the stored names that fold into it. */
const mergedInto = new Map<string, string[]>();
for (const [from, to] of Object.entries(MERGED_DJ_LABELS)) mergedInto.set(key(to.group, to.label), [...(mergedInto.get(key(to.group, to.label)) ?? []), from]);
const heads = new Map(learned.heads.map(h => [key(h.group, h.label), h]));
const shortHeads = new Map(shortClip.heads.map(h => [key(h.group, h.label), h]));
const promptCount = new Map<string, number>();
for (const p of prompts) promptCount.set(key(p.group, p.label ?? ''), (promptCount.get(key(p.group, p.label ?? '')) ?? 0) + 1);
const taggerFor = new Map<string, typeof TAGGER_POLICY.tags>();
for (const t of TAGGER_POLICY.tags) {
  const targets = [...t.decides.map(label => ({ dimension: t.dimension, label })), ...(t.alsoDecides ?? [])];
  for (const { dimension, label } of targets) { const k = key(GROUP_OF_DIMENSION[dimension], label); if (catalog.has(k)) taggerFor.set(k, [...(taggerFor.get(k) ?? []), t]); }
}
const via = (k: string, own: string) => k === own ? '' : ` (via merged ${k.slice(k.indexOf(':') + 1)})`;
const longRule = (t: typeof TAGGER_POLICY.tags[number]) => !t.long ? '' : ` ; long: ${t.long.rule}${t.long.afterSeconds ? ` >${t.long.afterSeconds}s` : ''}${t.long.threshold ? ` @${t.long.threshold}` : ''}`;

interface Row { group: DjGroup; label: string; display: string; brain: string; tagger: string; head: string; short: string; prompt: string; notes: string }
const rows: Row[] = [];
const counts = new Map<string, number>();
for (const group of ['source', 'production', 'character'] as const) for (const label of DJ_PICKER_LABELS[group]) {
  const own = key(group, label), names = [own, ...(mergedInto.get(own) ?? [])];
  const tg = names.flatMap(k => (taggerFor.get(k) ?? []).map(t => ({ k, t })));
  const hd = names.flatMap(k => heads.has(k) ? [{ k, h: heads.get(k)! }] : []);
  const sh = names.flatMap(k => shortHeads.has(k) ? [{ k, h: shortHeads.get(k)! }] : []);
  const pc = names.reduce((n, k) => { const cat = catalog.get(k); return n + (cat ? promptCount.get(key(cat.axis, cat.label)) ?? 0 : 0); }, 0);
  const tagger = tg.length ? tg.map(({ k, t }) => `\`${t.output}\` cutoff ${t.threshold}${t.tested ? '' : ' (maybe)'}${t.minSeconds ? ` ; min ${t.minSeconds}s` : ''}${longRule(t)}${via(k, own)}`).join('<br>') : '—';
  const head = hd.length ? hd.map(({ k, h }) => `${h.threshold.toFixed(3)}${h.maybe ? ' maybe' : ''}${h.oneShot ? ' one-shot too' : ''}${via(k, own)}`).join('<br>') : '—';
  const short = sh.length ? sh.map(({ k, h }) => `${h.threshold.toFixed(3)}${h.maybe ? ' maybe' : ''}${via(k, own)}`).join('<br>') : '—';
  const rule = group === 'character' && isRuleDescribedLabel(label);
  const prompt = pc === 0 ? 'no prompt' : rule ? `${pc} prompts, never shown (DSP rule word)` : CALIBRATED_LABELS.has(label) ? `${pc} prompts, never shown (tested detector exists)`
    : UNVERIFIED_BLOCKED.has(label) ? `${pc} prompts, blocked (measured almost always wrong)` : `${pc} prompts, shown as faded "possible" at similarity ≥ 0.5 on clips > ${SHORT_CLIP_MAX_SECONDS} s`;
  let brain: string;
  if (HIDDEN_UNTIL_TESTED.has(label)) brain = 'hidden until tested (never shown)';
  else if (rule) brain = 'DSP rule (timbreDescriptions), no model';
  else {
    const b: string[] = [];
    if (tg.length) b.push('tagger');
    if (hd.length) b.push('CLAP head' + (hd.every(({ h }) => h.maybe) ? ' (maybe)' : ''));
    if (sh.length) b.push(`one-shot head (clips ≤ ${SHORT_CLIP_MAX_SECONDS} s)`);
    if (!b.length) b.push(pc && !UNVERIFIED_BLOCKED.has(label) ? 'raw CLAP prompt only' : pc ? 'nothing (blocked prompt)' : 'nothing');
    brain = b.join(' + ') + (tg.length && (hd.length || sh.length) ? ' ; tagger wins inside its windows' : '');
  }
  counts.set(brain.split(' ;')[0], (counts.get(brain.split(' ;')[0]) ?? 0) + 1);
  const notes: string[] = [];
  if (DJ_HIDDEN_LABELS.has(own)) notes.push('hidden from picker list (searchable)');
  if (HIDDEN_UNTIL_TESTED.has(label)) notes.push('HIDDEN_UNTIL_TESTED');
  if (mergedInto.get(own)?.length) notes.push('also shows: ' + mergedInto.get(own)!.map(k => k.slice(k.indexOf(':') + 1)).join(', '));
  const display = soundLabelText(label);
  rows.push({ group, label, display: display !== label ? display : '', brain, tagger, head, short, prompt, notes: notes.join('; ') });
}
const pickable = Object.values(DJ_PICKER_LABELS).flat().length, merged = Object.keys(MERGED_DJ_LABELS).length, hidden = DJ_HIDDEN_LABELS.size;
const taggerOutputsOutsidePolicy = DJ_CATALOG.filter(c => taggerClasses.includes(`cat:${c.label}`) && !TAGGER_POLICY.tags.some(t => t.output === `cat:${c.label}`)).length;
const GROUPNAME: Record<DjGroup, string> = { source: 'Source', production: 'Production', character: 'Character' };
const out: string[] = [];
out.push('# Tag decision map: which brain decides each sound tag\n');
out.push(`Generated by \`scripts/tag-decision-map.ts\` (main at \`${commit}\`) from \`src/audio/djTags.ts\`, \`src/audio/taggerPolicy.json\`, \`public/sound-model/learned.json\`, \`public/sound-model/short-clip.json\`, \`public/sound-model/prompts.json\` and the display policy in \`src/audio/confidentSoundSummary.ts\`. Rerun it when any of those files change (\`npx vite-node scripts/tag-decision-map.ts\`; \`--check\` only verifies): the table is read straight from them, nothing in it is typed by hand.\n`);
out.push('## How a tag gets onto the screen (plain version)\n');
out.push(`The app has three detectors plus one fallback, and a display rule that picks between them:

1. **Trained tagger** (\`src/audio/tagger.ts\`, ONNX model \`cmjatom/dge-all-tags-tagger-nc\`). It listens to whole 10 s windows at 32 kHz (one padded window for a short clip, the middle 30 s of a long song). A tag in \`taggerPolicy.json\` shows when the best window's score passes that tag's cutoff. Cutoffs are applied when the track is shown, so changing one needs no re-analysis. On recordings longer than 30 s most entries hand the tag back to the other detectors (\`long: detectors\`). Inside the windows it heard, the tagger **replaces** every other detector for the labels in its \`decides\` list (the display drops their scores there). The model also scores ${taggerOutputsOutsidePolicy} catalog labels that are not in the policy (kick, clap, hi-hat, snare, ...); the app never reads them: \`TaggerEvidence\` keeps policy outputs only and \`taggerDecisions\` walks the policy, so an unlisted output such as \`cat:hi-hat\` cannot show a tag until a policy entry names it.
2. **CLAP trained heads** (\`learned.json\`, read by \`learnedDjScores\`). Every 10 s CLAP window (hop 5 s, repeat-padded when shorter) gets a 512-number fingerprint; each head is a logistic regression on that fingerprint with its own cutoff. A head that fires in any window adds its tag; "maybe" heads show faded. The reviewed-example path in the same file holds ${learned.examples.length} examples today.
3. **One-shot heads** (\`short-clip.json\`). Only for whole clips of at most ${SHORT_CLIP_MAX_SECONDS} s. On those clips the regular CLAP heads are switched off unless marked \`oneShot\` (vinyl scratch, impact, laser), and these ${shortClip.heads.length} heads decide instead.
4. **Raw CLAP prompts** (\`prompts.json\`, picked by \`selectDjTags\`): cosine similarity to text prompts, compared within an axis (top prompt must beat its cutoff and lead the runner-up by a margin). The display shows such a tag only as a faded "possible" on clips longer than ${SHORT_CLIP_MAX_SECONDS} s when the similarity is at least 0.5, and never for a label that already has a tested detector (\`calibratedLabels.json\`) or that was measured as almost always wrong (\`unverifiedBlocked.json\`).

Merged names (\`MERGED_DJ_LABELS\`) are folded at display time: a detector for \`closed hi-hat\` shows as **hi-hat**, \`bass hit\` / \`bass pluck\` / \`rubbery bass\` show as **synth bass**, \`turntable\` shows as **vinyl scratch**, and so on. The table lists those under the surviving name. Picker-hidden tags (\`DJ_HIDDEN_LABELS\`) still run and show on clips; they are just not listed until searched for. ${HIDDEN_UNTIL_TESTED.size} labels (${[...HIDDEN_UNTIL_TESTED].map(l => `\`${l}\``).join(', ')}) are hidden from every model until a detector passes real clips. Nine "feel" words (warm, airy, metallic, ...) come from DSP rules, never from a model.

Display floors: a tested score shows at 0.4 or more on recordings longer than ${SHORT_CLIP_MAX_SECONDS} s and 0.5 or more on one-shots; every head cutoff is at least 0.5, so in practice "head fired" means "tag shown". Tagger scores are rescaled so the cutoff reads as 0.5.
`);
out.push(`## Counts (${pickable} pickable tags = ${DJ_CATALOG.length} catalog labels minus ${merged} merged names; ${hidden} of the ${pickable} are picker-hidden)\n`);
out.push('| Deciding brain today | Tags |\n|---|---|');
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) out.push(`| ${k} | ${v} |`);
out.push('\nRead "CLAP head (maybe)" as: the only detector is a head that did not reach the 50/50 bar, so the tag shows faded. "Raw CLAP prompt only" tags have no tested detector at all; they can only appear as a faded "possible" guess, and the blocked ones not even that.\n');
out.push('## Known precedence and traps\n');
out.push(`- **Tagger beats CLAP inside its windows.** For a tag with both (drums, synthesizer, foley, bell, percussion, ...), the CLAP head only matters on audio the tagger did not score: recordings longer than 30 s (or 10 s for \`max\`-rule tags without a long rule) when the entry says \`long: detectors\`, and recordings shorter than \`minSeconds\`.
- **One-shots are a separate world.** On a clip of ${SHORT_CLIP_MAX_SECONDS} s or less (most drum hits), kick / clap / hi-hat / snare / cymbal are decided by \`short-clip.json\`, not by \`learned.json\`. The learned kick head never runs on a one-shot kick sample; the one-shot kick head does. "synth bass" on a one-shot comes only from the \`bass hit\` one-shot head through the merge.
- **hi-hat** ${TAGGER_POLICY.tags.some(t => t.decides.includes('hi-hat')) ? `is decided by the tagger on recordings up to 30 s (cutoff ${TAGGER_POLICY.tags.find(t => t.decides.includes('hi-hat'))!.threshold}, PR #234); on longer recordings only the merged \`closed hi-hat\` maybe head remains, so a long hi-hat loop still has essentially no detector.` : `has no head of its own on clips longer than ${SHORT_CLIP_MAX_SECONDS} s: it shows there only through the merged \`closed hi-hat\` maybe head (faded). The tagger's \`cat:hi-hat\` output is in the model but not in the policy, so on a 4 s hi-hat loop the app has essentially no hi-hat detector.`}
- **synth bass** on clips longer than ${SHORT_CLIP_MAX_SECONDS} s: no head, prompt blocked. It cannot show today except through a listener's own confirmation.
- **downlifter** on screen is the tagger's \`cat:falling\` output (merged from \`production:downlifter\`); the CLAP \`falling\` head only applies outside the tagger's windows.
- **Clip length changes the brain**: a 2 s kick is decided by the one-shot head, a 4 s kick by the learned head, a 40 s drum loop also by the learned head (no tagger entry). Any measurement must therefore use clips of the lengths users upload.
`);
out.push('## The map\n');
out.push('Columns: *Decided by today* is the detector whose score the app actually shows. *Tagger* gives the policy output and cutoff (and the long-recording rule). *CLAP head* and *One-shot head* give cutoffs from `learned.json` / `short-clip.json`; "via merged x" means the detector is trained for label x and shown under this name. *Raw prompt* says whether the prompt fallback can ever show the tag.\n');
for (const group of ['source', 'production', 'character'] as const) {
  out.push(`\n### ${GROUPNAME[group]} tags\n`);
  out.push('| Tag | Decided by today | Tagger | CLAP head | One-shot head | Raw prompt | Notes |\n|---|---|---|---|---|---|---|');
  for (const r of rows.filter(r => r.group === group)) out.push(`| ${r.display ? `**${r.display}** (stored as \`${r.label}\`)` : `**${r.label}**`} | ${r.brain} | ${r.tagger} | ${r.head} | ${r.short} | ${r.prompt} | ${r.notes} |`);
}
out.push('\n## Merged names (shown and confirmed under another name)\n\n| Stored label | Shown as |\n|---|---|');
for (const [from, to] of Object.entries(MERGED_DJ_LABELS)) out.push(`| \`${from}\` | \`${to.group}:${to.label}\` |`);
out.push(`
## How to measure a tag the way the app decides it

\`scripts/eval-tag.ts\` runs this exact chain (CLAP windows, heads, one-shot heads, prompt selection, tagger windows, then \`confidentSoundSummary\`) on labelled clips and reports precision, recall and false-alarm rate at the current cutoffs plus a cutoff sweep for each candidate brain. See the header of that script for usage.
`);
const text = out.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8').replace(/\(main at `[^`]*`\)/, '(main at `x`)');
  if (current !== text.replace(/\(main at `[^`]*`\)/, '(main at `x`)')) { console.error(`${OUT} is out of date; run npx vite-node scripts/tag-decision-map.ts`); process.exit(1); }
  console.log('docs/tag-decision-map.md is up to date');
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}: ${rows.length} pickable tags`); }
