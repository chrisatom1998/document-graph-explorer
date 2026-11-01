/* Measure one or more sound tags the way the app decides them.
 *
 * Runs the app's own chain on labelled clips: CLAP fingerprints (transformers.js, the q8 weights in public/sound-model,
 * 10 s windows with a 5 s hop as analyzeDecodedMusic plans them), the trained heads in learned.json, the one-shot heads
 * in short-clip.json for clips of at most 2.25 s, prompt selection (selectDjTags), the trained tagger (public/tagger-model,
 * whole 10 s windows at 32 kHz as taggerWindowStarts cuts them) and finally the display policy (confidentSoundSummary).
 * A tag counts as "shown" when that display lists it, normal or faded "maybe".
 *
 * Not run: AST and Jamendo (the sound profile is built with those two marked incomplete). They never change a trained
 * head's or the tagger's decision: applyDjClassification and mergeDjTags filter raw-prompt tags by the AST source, but
 * both end with applyReviewedDecisions, which puts every fired head back. They only steer raw-CLAP guesses, which the
 * display shows as faded "possible" at best. The one-shot event windows of long recordings (vinyl scratch only) are also
 * skipped, and the nine DSP-rule words (warm, airy, metallic, ...) are refused as targets because no model decides them.
 *
 * Audio: file-backed clips (--clips, or --set with --audio-dir) are decoded by FFmpeg straight to 48 kHz for CLAP and
 * 32 kHz for the tagger, as the app does. A .npy set holds 32 kHz audio only, so its CLAP windows are upsampled from
 * 32 kHz: anything above 16 kHz is missing, which can move hi-hat or cymbal fingerprints. The report says which it was.
 *
 * Labelled clips, either form:
 *   --clips <dir>            <dir>/yes/*.wav and <dir>/no/*.wav for one tag (--tag), or <dir>/<tag>/yes|no for several.
 *                            Group (for the pick/check halves) = text before the first "_" or "-" in the file name.
 *   --set <items.json>       A prepared set: {items:[{id, artist, labels:{"cat:kick":"present"|"absent"|1|0}}], offsets?}
 *                            with a flat or 2-D int16 32 kHz .npy next to it (the project's prep-cache format), or with
 *                            --audio-dir <dir> holding the original files as <dir>/<id after the colon>.wav (--audio-ext).
 * Usage:
 *   npx vite-node scripts/eval-tag.ts --tag kick,clap --clips path/to/clips --cache .cache/eval --out report.json
 *   npx vite-node scripts/eval-tag.ts --tag "synth bass" --set eval-nsynth-test.json --score-only --shard 0/2
 *   npx vite-node scripts/eval-tag.ts --tag kick --set eval-fsd50k.json --decide-only --watch drums,cymbal
 * Options: --cache <dir> (per-clip model outputs, reused by later runs), --limit N, --shard i/n, --threads N,
 *          --clap-backend cpu|wasm (wasm = the browser's own runtime, slower; cached separately),
 *          --learned / --short-clip / --policy <file> (evaluate another branch's or a proposed model file as "today"),
 *          --row-seconds N (fixed-length .npy rows: the clips' real length, e.g. 4 for NSynth notes),
 *          --score-only / --decide-only, --watch a,b (extra tags measured under every candidate), --decisions <file> (shown tags per clip, today's cutoffs), --parity (check the
 *          tagger against src/audio/taggerParity.fixture.json first), --grid-tagger / --grid-head "0.1,0.2,...".
 * Requires: npm run setup:music (model weights) and ffmpeg on PATH (resampling, decoding).
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { DJ_CATALOG, DjTagEvidence, MERGED_DJ_LABELS, selectDjTags, type DjGroup } from '../src/audio/djTags';
import { mergeDjTags } from '../src/audio/djClassification';
import { combineSoundModels } from '../src/audio/ensemble';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';
import { DescriptionAccumulator, descriptionScores, type DescriptionPrompt, type DescriptionScore } from '../src/audio/profileDescriptions';
import { learnedDjScores, sanitizeLearnedDjModel, type LearnedDjModel } from '../src/audio/learnedDjModel';
import { sanitizeShortClipModel, shortClipScores, SHORT_CLIP_MAX_SECONDS, type ShortClipModel } from '../src/audio/shortClipModel';
import { instrumentWindowStarts } from '../src/audio/instrumentEvidence';
import { TAGGER_POLICY, TAGGER_SAMPLE_RATE, TAGGER_WINDOW_SAMPLES, TaggerEvidence, taggerWindow, taggerWindowStarts, type TaggerTag } from '../src/audio/tagger';
import type { MusicAnalysis } from '../src/audio/musicTypes';
import { inputCacheIdentity } from './eval-tag-input';
import { isRuleDescribedLabel } from '../src/audio/timbreDescriptions';
import { soundReviewKey } from '../src/audio/soundReviewIdentity';

// ---------- arguments ----------
const argv = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`); if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) { console.error(`--${name} needs a value`); process.exit(2); }
  return value;
};
const num = (name: string, fallback: string) => { const v = Number(opt(name, fallback)); if (!Number.isFinite(v) || v < 0) { console.error(`--${name} must be a number, got "${opt(name, fallback)}"`); process.exit(2); } return v; };
const flag = (name: string) => argv.includes(`--${name}`);
const tags = (opt('tag') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const watch = (opt('watch') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const clipsDir = opt('clips'), setPath = opt('set');
const cacheDir = opt('cache', '.cache/eval-tag')!;
const audioDir = opt('audio-dir'), audioExt = opt('audio-ext', '.wav')!;
const outPath = opt('out');
const limit = num('limit', '0');
const [shardIndex, shardCount] = (opt('shard', '0/1')!).split('/').map(Number);
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) { console.error('--shard must be i/n with 0 <= i < n'); process.exit(2); }
if (!['cpu', 'wasm'].includes(opt('clap-backend', 'cpu')!)) { console.error('--clap-backend must be cpu or wasm'); process.exit(2); }
const threads = num('threads', '0');
/** Fixed-length .npy rows: the clip's real length in seconds (e.g. 4 for NSynth notes); without it trailing digital silence is trimmed. */
const rowSeconds = num('row-seconds', '0');
/** 'cpu' (onnxruntime-node, fast) or 'wasm' (onnxruntime-web, the runtime the browser uses). Same q8 weights either way; on three
 * clips the two agreed to a cosine of 0.9996 or better, so 'cpu' is the default and 'wasm' is the slow, exact check. */
const clapBackend = opt('clap-backend', 'cpu') as 'cpu' | 'wasm';
if (!tags.length || (!clipsDir && !setPath)) { console.error('Pass --tag <label[,label]> and --clips <dir> or --set <items.json>. See the header of this file.'); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

// ---------- the app's models and lists ----------
const soundManifest = JSON.parse(readFileSync(join(PUBLIC, 'sound-model/manifest.json'), 'utf8')) as { repository: string; revision: string; sha256: Record<string, string> };
const prompts = JSON.parse(readFileSync(join(PUBLIC, 'sound-model/prompts.json'), 'utf8')) as DescriptionPrompt[];
// Candidate model files (a branch's learned.json, a proposed short-clip.json or taggerPolicy.json) can stand in for
// the shipped ones; the cached model outputs are reused because the CLAP weights and the tagger weights do not change.
const learnedRaw = JSON.parse(readFileSync(opt('learned') ?? join(PUBLIC, 'sound-model/learned.json'), 'utf8'));
const shortRaw = JSON.parse(readFileSync(opt('short-clip') ?? join(PUBLIC, 'sound-model/short-clip.json'), 'utf8'));
if (opt('policy')) { const alt = JSON.parse(readFileSync(opt('policy')!, 'utf8')) as typeof TAGGER_POLICY; if (alt.modelSha256 !== TAGGER_POLICY.modelSha256) throw new Error('--policy is for another tagger model'); TAGGER_POLICY.tags.length = 0; TAGGER_POLICY.tags.push(...alt.tags); }
const learned = sanitizeLearnedDjModel(learnedRaw), shortClip = sanitizeShortClipModel(shortRaw);
if (!learned || !shortClip) throw new Error('learned.json or short-clip.json did not pass the app\'s own sanitizer');
if (shortClip.blocks.some(b => b !== 'clapRepeat')) throw new Error(`short-clip model uses blocks ${shortClip.blocks.join(', ')}; this evaluator only computes clapRepeat (the shipped model's one block)`);
const taggerMeta = JSON.parse(readFileSync(join(PUBLIC, 'tagger-model/model.json'), 'utf8')) as { classes: string[]; sha256: Record<string, string> };
const taggerClasses = taggerMeta.classes;
const modelIdentity = { clap: soundManifest.sha256['onnx/audio_model_quantized.onnx'], tagger: taggerMeta.sha256['model.onnx'] };
if (modelIdentity.tagger !== TAGGER_POLICY.modelSha256) throw new Error('public/tagger-model/model.json does not match taggerPolicy.json');

interface ResolvedTag { input: string; group: DjGroup; label: string; dimension: 'source' | 'effect' | 'character'; displayKey: string; setKeys: string[];
  /** Folder names a --clips directory may use for this tag: the name as typed, the catalog label, the merged destination. */
  folders: string[];
  /** The stored identities whose detectors show under this name: the merged destination first, then every name folded into it. */
  names: { group: DjGroup; label: string }[] }
/** "kick" -> the catalog label, its display dimension and the key it shows under after merges. */
function resolveTag(input: string): ResolvedTag {
  const raw = input.includes(':') ? input.split(':') : [undefined, input];
  const label = raw[1]!.trim().toLowerCase();
  const hit = DJ_CATALOG.find(c => c.label === label && (!raw[0] || c.group === raw[0])) ?? DJ_CATALOG.find(c => c.aliases.includes(label));
  if (!hit) throw new Error(`Unknown tag "${input}"; use a label from src/audio/djCatalog.json`);
  if (hit.group === 'character' && isRuleDescribedLabel(hit.label)) throw new Error(`"${hit.label}" comes from DSP rules (timbreDescriptions.ts), not from a model; this evaluator cannot measure it`);
  const m = MERGED_DJ_LABELS[`${hit.group}:${hit.label}`] ?? { group: hit.group as DjGroup, label: hit.label };
  const dimension = m.group === 'source' ? 'source' : m.group === 'production' ? 'effect' : 'character';
  const names = [m, ...Object.entries(MERGED_DJ_LABELS).filter(([, to]) => to.group === m.group && to.label === m.label).map(([from]) => ({ group: from.split(':')[0] as DjGroup, label: from.slice(from.indexOf(':') + 1) }))];
  // A set may label the name typed, the merged destination or any name folded into it; the tag shows when any of them fires.
  const setKeys = [...new Set([{ group: hit.group, label: hit.label }, ...names].flatMap(n => [`cat:${n.label}`, n.label, `${n.group}:${n.label}`]))];
  return { input, group: m.group, label: m.label, dimension, displayKey: `${dimension}:${m.label}`, setKeys, folders: [...new Set([label, hit.label, m.label])], names };
}
const targets = tags.map(resolveTag), watched = watch.map(resolveTag);

// ---------- clips ----------
/** `read(rate)` decodes the clip at that rate; a file-backed clip decodes straight from the file (as the app does), a .npy clip
 * resamples its 32 kHz samples. */
interface Clip { id: string; group: string; labels: Record<string, 0 | 1>; read: (rate: number) => Float32Array; fromFile: boolean }
const fnv = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const half = (group: string) => fnv(group) % 2 === 0 ? 'pick' : 'check';
function parseNpy(path: string): { offset: number; shape: number[]; dtype: string } {
  const fd = openSync(path, 'r'); const head = Buffer.alloc(12); readSync(fd, head, 0, 12, 0);
  if (head.toString('latin1', 0, 6) !== '\x93NUMPY') throw new Error(`${path} is not a .npy file`);
  const major = head[6], headerLen = major === 1 ? head.readUInt16LE(8) : head.readUInt32LE(8), start = major === 1 ? 10 : 12;
  const hb = Buffer.alloc(headerLen); readSync(fd, hb, 0, headerLen, start); closeSync(fd);
  const header = hb.toString('latin1');
  const shape = (header.match(/'shape': \(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const dtype = header.match(/'descr': '([^']+)'/)?.[1] ?? '';
  if (dtype !== '<i2') throw new Error(`${path}: expected int16 ('<i2'), got ${dtype}`);
  if (/'fortran_order': True/.test(header)) throw new Error(`${path}: Fortran order is not supported`);
  return { offset: start + headerLen, shape, dtype };
}
function readInt16(path: string, offset: number, firstSample: number, count: number): Float32Array {
  const fd = openSync(path, 'r'); const buf = Buffer.alloc(count * 2); readSync(fd, buf, 0, count * 2, offset + firstSample * 2); closeSync(fd);
  const out = new Float32Array(count); for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(i * 2) / 32768; return out;
}
const labelOf = (labels: Record<string, unknown>, t: ResolvedTag): 0 | 1 | undefined => {
  let absent = false;
  for (const k of t.setKeys) if (k in labels) { const v = labels[k]; if (v === 'present' || v === 1 || v === true || v === '1') return 1; if (v === 'absent' || v === 0 || v === false || v === '0') absent = true; }
  return absent ? 0 : undefined;
};
function loadSet(path: string): { name: string; clips: Clip[] } {
  const meta = JSON.parse(readFileSync(path, 'utf8')) as { items: { id: string; artist?: string; labels?: Record<string, unknown> }[]; offsets?: number[] };
  const npyPath = opt('npy') ?? path.replace(/\.json$/, '.npy');
  const npy = audioDir ? undefined : parseNpy(npyPath); // the .npy is only read when the audio is not given as files
  const seen = new Set<string>();
  for (const item of meta.items) { if (seen.has(item.id)) throw new Error(`${path}: duplicate item id ${item.id} (the cache keys clips by id)`); seen.add(item.id); }
  const clips: Clip[] = meta.items.map((item, i) => {
    const labels: Record<string, 0 | 1> = {};
    for (const t of [...targets, ...watched]) { const v = labelOf(item.labels ?? {}, t); if (v !== undefined) labels[t.displayKey] = v; }
    let first = 0, count = 0;
    if (npy) { if (meta.offsets) { first = meta.offsets[i]; count = meta.offsets[i + 1] - first; } else { count = npy.shape[1]; first = i * count; } }
    const read32 = () => {
      let s = readInt16(npyPath, npy!.offset, first, count);
      // Fixed-length rows pad each clip with digital silence; the app would see the clip's own length.
      if (!meta.offsets) {
        if (rowSeconds > 0) s = s.subarray(0, Math.min(s.length, Math.round(rowSeconds * TAGGER_SAMPLE_RATE)));
        else { let n = s.length; while (n > 0 && s[n - 1] === 0) n--; s = s.subarray(0, Math.max(n, 1)); }
      }
      return s;
    };
    const file = audioDir ? join(audioDir, item.id.slice(item.id.indexOf(':') + 1) + audioExt) : undefined;
    const read = file ? (rate: number) => decode(file, rate) : (rate: number) => rate === TAGGER_SAMPLE_RATE ? read32() : resample(read32(), rate);
    return { id: item.id, group: item.artist || item.id, labels, read, fromFile: !!file };
  });
  if (audioDir) { const missing = clips.filter(c => !existsSync(join(audioDir, c.id.slice(c.id.indexOf(':') + 1) + audioExt))).length; if (missing) console.log(`${missing} of ${clips.length} clips have no file under ${audioDir}; they remain unscored and count toward completeness`); }
  return { name: basename(path, '.json') + (audioDir ? '-files' : ''), clips };
}
const AUDIO = /\.(wav|mp3|ogg|flac|aiff?|m4a|opus|webm)$/i;
function decode(path: string, rate: number): Float32Array {
  const bytes = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
function loadClips(dir: string): { name: string; clips: Clip[] } {
  // Watched tags read <dir>/<tag>/yes|no too, so they get ground truth under every candidate like the targets.
  const folderFor = (t: ResolvedTag) => t.folders.map(f => join(dir, f)).filter(existsSync);
  const perTag = [...(targets.length === 1 && existsSync(join(dir, 'yes')) ? [[targets[0], [dir]] as const] : targets.map(t => [t, folderFor(t)] as const)),
    ...watched.map(t => [t, folderFor(t)] as const)];
  const byId = new Map<string, Clip>();
  for (const [t, folders] of perTag) for (const folder of folders) for (const answer of ['yes', 'no'] as const) {
    const sub = join(folder, answer); if (!existsSync(sub)) continue;
    for (const file of readdirSync(sub).filter(f => AUDIO.test(f)).sort()) {
      const path = join(sub, file), id = path.slice(dir.length + 1);
      const clip = byId.get(id) ?? { id, group: basename(file).split(/[_-]/)[0], labels: {}, read: (rate: number) => decode(path, rate), fromFile: true };
      clip.labels[t.displayKey] = answer === 'yes' ? 1 : 0; byId.set(id, clip);
    }
  }
  return { name: basename(resolve(dir)), clips: [...byId.values()] };
}
const set = setPath ? loadSet(setPath) : loadClips(clipsDir!);
let clips = set.clips.filter(c => Object.keys(c.labels).length);
const unlabelled = set.clips.length - clips.length;
if (limit) clips = clips.slice(0, limit);
const shardClips = clips.filter((_, i) => i % shardCount === shardIndex);
console.log(`${set.name}: ${clips.length} labelled clips (${unlabelled} without a label for ${tags.join(', ')})` + (shardCount > 1 ? `; shard ${shardIndex}/${shardCount}: ${shardClips.length}` : ''));

// ---------- phase 1: model outputs per clip, cached ----------
interface CachedWindow { start: number; end: number; embedding: number[] | null }
interface CachedClip { id: string; group: string; duration: number; labels: Record<string, 0 | 1>; clap: CachedWindow[]; tagger: { start: number; end: number; scores: number[] }[]; clapAudio?: 'file' | 'resampled-32k' }
mkdirSync(cacheDir, { recursive: true });
// Content identity includes the selected audio and row interpretation, but not labels: current annotations are overlaid below.
const inputPaths: string[] = [];
let interpretation: unknown = { rowSeconds };
if (setPath) {
  const meta = JSON.parse(readFileSync(setPath, 'utf8'));
  if (audioDir) {
    for (const item of meta.items) { const file = join(audioDir, item.id.slice(item.id.indexOf(':') + 1) + audioExt); if (existsSync(file)) inputPaths.push(file); }
  } else inputPaths.push(opt('npy') ?? setPath.replace(/\.json$/, '.npy'));
  interpretation = { rowSeconds, fromFiles: !!audioDir, ids: meta.items.map((item: { id: string }) => item.id), offsets: meta.offsets };
} else {
  // All files, including currently unlabelled ones, keep target/watch changes reusable.
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (entry.isFile() && AUDIO.test(entry.name)) inputPaths.push(path);
  } };
  walk(clipsDir!);
}
const inputIdentity = inputCacheIdentity(inputPaths, interpretation);
const cachePrefix = `${set.name}.${inputIdentity}.${modelIdentity.clap.slice(0, 8)}${clapBackend === 'wasm' ? '-wasm' : ''}-${modelIdentity.tagger.slice(0, 8)}.`;
const cacheFile = (i: number, n: number) => join(cacheDir, `${cachePrefix}shard-${i}-of-${n}.jsonl`);
function readCache(): Map<string, CachedClip> {
  const out = new Map<string, CachedClip>();
  for (const f of readdirSync(cacheDir).filter(f => f.startsWith(cachePrefix) && f.endsWith('.jsonl')))
    for (const line of readFileSync(join(cacheDir, f), 'utf8').split('\n')) if (line) { const rec = JSON.parse(line) as CachedClip; out.set(rec.id, rec); }
  return out;
}
const audible = (samples: Float32Array) => samples.length > 0 && samples.reduce((sum, v) => sum + v * v, 0) / samples.length > 1e-8;
function resample(samples32: Float32Array, rate: number): Float32Array {
  // The app decodes every window with FFmpeg at the model's rate; the CLI resampler is the closest match outside the browser.
  const input = Buffer.from(samples32.buffer, samples32.byteOffset, samples32.byteLength);
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'f32le', '-ar', String(TAGGER_SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg resample failed: ${r.stderr?.toString().slice(0, 200)}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
}
async function loadModels() {
  const tf = await import('@huggingface/transformers');
  tf.env.allowRemoteModels = false; tf.env.allowLocalModels = true; tf.env.localModelPath = PUBLIC + '/';
  const session_options = threads ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : undefined;
  const clap = await tf.ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true, ...(session_options ? { session_options } : {}) });
  const processor = await tf.AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
  const ort = await import('onnxruntime-node');
  const tagger = await ort.InferenceSession.create(join(PUBLIC, 'tagger-model/model.onnx'), { executionProviders: ['cpu'], ...(threads ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {}) });
  const ortWeb = clapBackend === 'wasm' ? await import('onnxruntime-web') : undefined;
  if (ortWeb) ortWeb.env.wasm.numThreads = 1;
  const clapWasm = ortWeb ? await ortWeb.InferenceSession.create(new Uint8Array(readFileSync(join(PUBLIC, 'sound-model/onnx/audio_model_quantized.onnx'))), { executionProviders: ['wasm'] }) : undefined;
  const embed = async (samples48: Float32Array): Promise<number[]> => {
    const inputs = await processor(samples48);
    if (ortWeb && clapWasm) {
      const features = inputs.input_features as { data: Float32Array; dims: number[] };
      const output = await clapWasm.run({ input_features: new ortWeb.Tensor('float32', features.data, features.dims) });
      return Array.from(output.audio_embeds.data as Float32Array, (v: number) => Math.round(v * 1e6) / 1e6);
    }
    const output = await clap(inputs);
    try { return Array.from(output.audio_embeds.data as Float32Array, (v: number) => Math.round(v * 1e6) / 1e6); } finally { await output.audio_embeds.dispose?.(); }
  };
  const tag = async (samples32: Float32Array): Promise<number[]> => {
    const input = new ort.Tensor('float32', taggerWindow(samples32), [1, TAGGER_WINDOW_SAMPLES]);
    const outputs = await tagger.run({ [TAGGER_POLICY.input.name]: input });
    const scores = Array.from(outputs[TAGGER_POLICY.input.output].data as Float32Array);
    if (scores.length !== taggerClasses.length) throw new Error('Tagger returned an unexpected number of scores.');
    return scores;
  };
  return { embed, tag, dispose: async () => { await clap.dispose(); await tagger.release(); await clapWasm?.release(); } };
}
async function parityCheck(tag: (s: Float32Array) => Promise<number[]>) {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'src/audio/taggerParity.fixture.json'), 'utf8')) as { model: string; cases: { seconds: number; scores: Record<string, number> }[] };
  if (fixture.model !== TAGGER_POLICY.modelSha256) { console.log('parity: fixture is for another model, skipped'); return; }
  let worst = 0;
  for (const c of fixture.cases) {
    const n = Math.round(c.seconds * TAGGER_SAMPLE_RATE), audio = new Float32Array(n); let state = 12345;
    for (let i = 0; i < n; i++) { const t = i / TAGGER_SAMPLE_RATE; state = (state * 1664525 + 1013904223) % 4294967296; const noise = state / 4294967296 - 0.5;
      const x = 0.25 * Math.sin(2 * Math.PI * 110 * t) + 0.15 * Math.sin(2 * Math.PI * 1760 * t) * (Math.sin(2 * Math.PI * 2 * t) > 0 ? 1 : 0) + 0.1 * Math.sin(2 * Math.PI * (300 + 40 * (t % 5)) * t) + 0.08 * noise;
      audio[i] = Math.max(-32768, Math.min(32767, Math.floor(x * 32767 + 0.5))) / 32768; }
    const evidence = new TaggerEvidence();
    for (const start of taggerWindowStarts(c.seconds)) { const from = Math.round(start * TAGGER_SAMPLE_RATE); const s = await tag(audio.slice(from, from + TAGGER_WINDOW_SAMPLES)); evidence.add(Object.fromEntries(taggerClasses.map((k, i) => [k, s[i]]))); }
    const result = evidence.results()!;
    for (const [output, want] of Object.entries(c.scores)) worst = Math.max(worst, Math.abs(result.scores[output] - want));
  }
  console.log(`parity: worst tagger difference from the Python scorer ${worst.toExponential(2)} (${worst < 1e-3 ? 'ok' : 'TOO LARGE'})`);
  if (worst >= 1e-3) throw new Error('Tagger parity failed');
}
async function scorePhase() {
  const cached = readCache();
  const todo = shardClips.filter(c => !cached.has(c.id));
  console.log(`${cached.size} clips already scored, ${todo.length} to score`);
  if (!todo.length && !flag('parity')) return;
  const models = await loadModels();
  if (flag('parity')) await parityCheck(models.tag);
  const file = cacheFile(shardIndex, shardCount), started = Date.now(); let done = 0;
  for (const clip of todo) {
    try {
      const pcm = clip.read(TAGGER_SAMPLE_RATE); const duration = pcm.length / TAGGER_SAMPLE_RATE;
      const rec: CachedClip = { id: clip.id, group: clip.group, duration, labels: clip.labels, clap: [], tagger: [], clapAudio: clip.fromFile ? 'file' : 'resampled-32k' };
      // The app decodes each CLAP window at 48 kHz from the source file; a .npy clip can only offer its 32 kHz samples.
      const pcm48 = clip.read(48000);
      for (const start of instrumentWindowStarts(duration)) {
        const end = Math.min(duration, start + 10);
        const samples48 = pcm48.subarray(Math.round(start * 48000), Math.min(pcm48.length, Math.round(end * 48000)));
        rec.clap.push({ start, end, embedding: audible(samples48) ? await models.embed(samples48) : null });
      }
      for (const start of taggerWindowStarts(duration)) {
        const seconds = Math.min(10, duration - start), from = Math.round(start * TAGGER_SAMPLE_RATE);
        rec.tagger.push({ start, end: start + seconds, scores: await models.tag(pcm.slice(from, from + Math.round(seconds * TAGGER_SAMPLE_RATE))) });
      }
      appendFileSync(file, JSON.stringify(rec) + '\n');
    } catch (error) { console.log(`  skip ${clip.id}: ${(error as Error).message.slice(0, 120)}`); }
    if (++done % 50 === 0 || done === todo.length) { const rate = done / ((Date.now() - started) / 1000); console.log(`  ${done}/${todo.length}  ${rate.toFixed(2)} clips/s  ~${((todo.length - done) / rate / 60).toFixed(0)} min left`); }
  }
  await models.dispose();
}

// ---------- phase 2: the app's decision under the current and candidate cutoffs ----------
interface Overrides { headThreshold?: Record<string, number>; shortThreshold?: Record<string, number>; taggerThreshold?: Record<string, number>; taggerAdd?: TaggerTag[] }
const withHeads = (model: LearnedDjModel, o: Record<string, number> | undefined): LearnedDjModel => !o ? model : { ...model, heads: model.heads!.map(h => o[`${h.group}:${h.label}`] !== undefined ? { ...h, threshold: o[`${h.group}:${h.label}`] } : h) };
const withShort = (model: ShortClipModel, o: Record<string, number> | undefined): ShortClipModel => !o ? model : { ...model, heads: model.heads.map(h => o[`${h.group}:${h.label}`] !== undefined ? { ...h, threshold: o[`${h.group}:${h.label}`] } : h) };
const promptCache = new Map<number[], DescriptionScore[]>();
const promptScores = (embedding: number[]) => { let s = promptCache.get(embedding); if (!s) { s = descriptionScores(embedding, prompts); promptCache.set(embedding, s); } return s; };
const policyTags = TAGGER_POLICY.tags;
function withPolicy<T>(o: Overrides, run: () => T): T {
  const original = [...policyTags];
  try {
    policyTags.length = 0;
    for (const t of original) policyTags.push(o.taggerThreshold?.[t.output] !== undefined ? { ...t, threshold: o.taggerThreshold[t.output] } : t);
    for (const t of o.taggerAdd ?? []) { const i = policyTags.findIndex(p => p.output === t.output); if (i >= 0) policyTags[i] = t; else policyTags.push(t); }
    return run();
  } finally { policyTags.length = 0; policyTags.push(...original); }
}
interface Shown { maybe: boolean; tier?: string; uncalibrated?: boolean }
/** What the Sounds row would list for this clip, keyed "dimension:label", with AST, Jamendo and the long-recording event
 * windows not run (see the header for why they do not move a head's or the tagger's decision). */
const SCOPE = 'AST, Jamendo and long-recording event windows not run';
function decide(rec: CachedClip, o: Overrides): Map<string, Shown> {
  const learnedModel = withHeads(learned!, o.headThreshold), shortModel = withShort(shortClip!, o.shortThreshold);
  return withPolicy(o, () => {
    const descriptions = new DescriptionAccumulator(), djEvidence = new DjTagEvidence();
    const oneShotHeads = new Set(learnedModel.heads?.filter(h => h.oneShot).map(h => `${h.group}:${h.label}`));
    for (const w of rec.clap) {
      if (!w.embedding) { descriptions.add([], w); continue; }
      let learnedScores = learnedDjScores(w.embedding, learnedModel, { shortRecording: rec.duration < 10 - 1e-3 });
      const short = w.start === 0 && w.end >= rec.duration - 1e-6 && rec.duration <= SHORT_CLIP_MAX_SECONDS && w.end - w.start <= shortModel.maxSeconds;
      const oneShot = short ? shortClipScores(shortModel, { clapRepeat: w.embedding }).scores : [];
      if (short) learnedScores = learnedScores.filter(s => s.basis !== 'head' || oneShotHeads.has(`${s.learnedGroup}:${s.label}`));
      const scores = [...promptScores(w.embedding), ...learnedScores, ...oneShot];
      descriptions.add(scores, w);
      djEvidence.add(selectDjTags(scores), w.start, w.end);
    }
    const evidence = new TaggerEvidence();
    for (const w of rec.tagger) evidence.add(Object.fromEntries(taggerClasses.map((k, i) => [k, w.scores[i]])), { start: w.start, end: w.end });
    const average = descriptions.average();
    const profile = combineSoundModels([], {}, average, { ast: false, jamendo: false, clap: true });
    mergeDjTags(profile, djEvidence.results(), average);
    const analysis: MusicAnalysis = { version: 2, durationSeconds: rec.duration, analyzedSeconds: rec.duration, instruments: [], notes: [], soundProfile: profile,
      tagger: evidence.results(), instrumentScan: { mode: 'full', complete: true, analyzedSeconds: rec.duration, windows: rec.clap.length } };
    const shown = new Map<string, Shown>(confidentSoundSummary(analysis).map(s => [`${s.dimension}:${s.label}`, { maybe: !!s.maybe, tier: s.tier, uncalibrated: !!s.uncalibrated }]));
    // One sound can show under another name the app treats as the same identity (soundReviewKey: a tagger's alsoDecides
    // aliases, e.g. the tagger's source "cymbals" for the one-shot "cymbal"). The set's label counts as shown under either.
    for (const [key, s] of [...shown]) { const [d, ...l] = key.split(':'); const id = `=${soundReviewKey(d as 'source', l.join(':'))}`; if (!shown.has(id) || (shown.get(id)!.maybe && !s.maybe)) shown.set(id, s); }
    return shown;
  });
}
interface Counts { positives: number; negatives: number; tp: number; fp: number; fn: number; tpMaybe: number; fpMaybe: number }
const blank = (): Counts => ({ positives: 0, negatives: 0, tp: 0, fp: 0, fn: 0, tpMaybe: 0, fpMaybe: 0 });
const metrics = (c: Counts) => ({ ...c, precision: c.tp + c.fp ? +(c.tp / (c.tp + c.fp)).toFixed(3) : null, recall: c.positives ? +(c.tp / c.positives).toFixed(3) : null,
  falseAlarmRate: c.negatives ? +(c.fp / c.negatives).toFixed(4) : null, passes6030: unscoredClips.length === 0 && c.tp + c.fp > 0 && c.positives > 0 && c.tp / (c.tp + c.fp) >= .6 && c.tp / c.positives >= .3 });
let unscoredClips: Clip[] = [];
function evaluate(records: CachedClip[], o: Overrides, keys: string[]) {
  type Part = 'pick' | 'check' | 'all' | 'oneShots' | 'longer';
  const table: Record<string, Record<Part, Counts>> = Object.fromEntries(keys.map(k => [k, { pick: blank(), check: blank(), all: blank(), oneShots: blank(), longer: blank() }]));
  const decisions: Record<string, string[]> = {};
  for (const clip of unscoredClips) for (const key of keys) {
    const truth = clip.labels[key]; if (truth === undefined) continue;
    for (const part of [half(clip.group), 'all'] as const) { const c = table[key][part]; if (truth) { c.positives++; c.fn++; } else c.negatives++; }
  }
  for (const rec of records) {
    const shown = decide(rec, o), h = half(rec.group), bucket: Part = rec.duration <= SHORT_CLIP_MAX_SECONDS ? 'oneShots' : 'longer';
    decisions[rec.id] = [...shown.keys()].filter(k => !k.startsWith('='));
    for (const key of keys) {
      const truth = rec.labels[key]; if (truth === undefined) continue;
      const [d, ...l] = key.split(':'), s = shown.get(key) ?? shown.get(`=${soundReviewKey(d as 'source', l.join(':'))}`);
      for (const part of [h, 'all', bucket] as const) {
        const c = table[key][part];
        if (truth) { c.positives++; if (s) { c.tp++; if (s.maybe) c.tpMaybe++; } else c.fn++; }
        else { c.negatives++; if (s) { c.fp++; if (s.maybe) c.fpMaybe++; } }
      }
    }
  }
  return { table: Object.fromEntries(keys.map(k => [k, { pick: metrics(table[k].pick), check: metrics(table[k].check), all: metrics(table[k].all), oneShots: metrics(table[k].oneShots), longer: metrics(table[k].longer) }])), decisions };
}
const parseGrid = (s: string | undefined, fallback: number[]) => s ? s.split(',').map(Number) : fallback;
const TAGGER_GRID = parseGrid(opt('grid-tagger'), [0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]);
const HEAD_GRID = parseGrid(opt('grid-head'), [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.925, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995]);
/** Precision first, as the app's cutoff PRs do: the lowest cutoff whose pick-half precision is at least 0.65, judged on the check half. */
function pickCutoff(points: { cutoff: number; pick: ReturnType<typeof metrics>; check: ReturnType<typeof metrics> }[]) {
  const ok = points.filter(p => p.pick.precision !== null && p.pick.precision >= .65 && p.pick.tp >= 3);
  const precisionFirst = ok.sort((a, b) => a.cutoff - b.cutoff)[0];
  const balanced = [...points].sort((a, b) => Math.min(b.pick.precision ?? 0, b.pick.recall ?? 0) - Math.min(a.pick.precision ?? 0, a.pick.recall ?? 0))[0];
  return { precisionFirst, balanced };
}
function decidePhase() {
  const cached = readCache();
  // The cache holds model outputs only as far as the decision is concerned: labels and groups come from the current set.
  const records = clips.map(c => { const r = cached.get(c.id); return r ? { ...r, labels: c.labels, group: c.group } : undefined; }).filter((r): r is CachedClip => !!r);
  // A clip that was never scored (not run yet, or FFmpeg/model failure) still counts: as a miss when it is labelled present.
  // A run with unscored clips is marked incomplete and cannot be read as a pass.
  const unscored = clips.filter(c => !cached.has(c.id));
  console.log(`deciding on ${records.length} scored clips (${unscored.length} not scored: counted as misses, run marked incomplete)`);
  const keys = [...new Set([...targets, ...watched].map(t => t.displayKey))];
  unscoredClips = unscored;
  const clapAudio = [...new Set(records.map(r => r.clapAudio ?? 'resampled-32k'))];
  console.log(`CLAP audio: ${clapAudio.join(' and ')}${clapAudio.includes('resampled-32k') ? ' (upsampled from 32 kHz: content above 16 kHz is missing, an approximation of the app)' : ' (decoded at 48 kHz from the files, as the app does)'}`);
  const report: Record<string, unknown> = { scope: SCOPE, set: set.name, clips: records.length, models: modelIdentity, inputIdentity, clapBackend, clapAudio, taggerRevision: TAGGER_POLICY.revision, learnedRevision: learned!.revision, shortClipRevision: shortClip!.revision,
    halves: 'groups (uploader / artist / file prefix) hashed into pick and check', unscoredClips: unscored.length, complete: unscored.length === 0, current: {}, candidates: {} };
  // Tested Jamendo scores (FULL_MIX_JAMENDO) can also show piano, synthesizer and drums on recordings of 10 s or more; this
  // evaluator does not run Jamendo, so for those three the "today" recall on such clips is a lower bound.
  const jamendoTags = [...targets, ...watched].filter(t => ['piano', 'synthesizer', 'drums'].includes(t.label) && records.some(r => r.duration >= 10));
  if (jamendoTags.length) { console.log(`note: ${jamendoTags.map(t => t.label).join(', ')} can also show through tested Jamendo scores on recordings of 10 s or more, which this evaluator does not run; "today" recall for them is a lower bound.`); report.jamendoLowerBound = jamendoTags.map(t => t.label); }
  const current = evaluate(records, {}, keys);
  (report.current as Record<string, unknown>) = current.table;
  // --decisions <file>: the tags shown per clip under today's cutoffs (for error analysis on a dev set; never tune on a judge set).
  const decisionsPath = opt('decisions'); if (decisionsPath) writeFileSync(decisionsPath, JSON.stringify(current.decisions));
  console.log(`\n== today (the app as shipped; ${SCOPE}) ==`);
  for (const k of keys) { const m = current.table[k]; console.log(`${k.padEnd(28)} all P ${fmt(m.all.precision)} R ${fmt(m.all.recall)} FA ${fmt(m.all.falseAlarmRate)}  (tp ${m.all.tp} fp ${m.all.fp} fn ${m.all.fn}; pos ${m.all.positives} neg ${m.all.negatives})  pick P ${fmt(m.pick.precision)} R ${fmt(m.pick.recall)}  check P ${fmt(m.check.precision)} R ${fmt(m.check.recall)}  one-shots R ${fmt(m.oneShots.recall)} (${m.oneShots.positives}) longer R ${fmt(m.longer.recall)} (${m.longer.positives})  ${m.all.passes6030 ? 'PASSES 60/30' : 'fails 60/30'}`); }
  const candidates = report.candidates as Record<string, unknown>;
  for (const t of targets) {
    const key = t.displayKey, out: Record<string, unknown> = {}; candidates[t.input] = out;
    const run = (name: string, make: (cutoff: number) => Overrides, grid: number[], note: string) => {
      const points = grid.map(cutoff => { const r = evaluate(records, make(cutoff), keys); return { cutoff, pick: r.table[key].pick, check: r.table[key].check, all: r.table[key].all, oneShots: r.table[key].oneShots, longer: r.table[key].longer, others: Object.fromEntries(keys.filter(k => k !== key).map(k => [k, r.table[k].all])) }; });
      const chosen = pickCutoff(points);
      out[name] = { note, points, chosen: { precisionFirst: chosen.precisionFirst?.cutoff ?? null, balanced: chosen.balanced?.cutoff ?? null } };
      console.log(`\n== ${t.input}: ${name} (${note}) ==`);
      for (const p of points) console.log(`  cutoff ${p.cutoff.toFixed(3).padEnd(6)} pick P ${fmt(p.pick.precision)} R ${fmt(p.pick.recall)} | check P ${fmt(p.check.precision)} R ${fmt(p.check.recall)} FA ${fmt(p.check.falseAlarmRate)} | all P ${fmt(p.all.precision)} R ${fmt(p.all.recall)} (tp ${p.all.tp} fp ${p.all.fp})`);
      if (chosen.precisionFirst) console.log(`  -> precision-first pick ${chosen.precisionFirst.cutoff}: check half P ${fmt(chosen.precisionFirst.check.precision)} R ${fmt(chosen.precisionFirst.check.recall)} ${chosen.precisionFirst.check.passes6030 ? 'PASSES 60/30' : 'fails 60/30'}`);
      else console.log('  -> no cutoff reaches 0.65 precision on the pick half');
    };
    // Candidates come from every stored identity that shows under this name: the merged destination first (downlifter ->
    // character:falling, vinyl scratch -> production:vinyl scratch + source:turntable), so a shipped entry for a merged name is
    // moved rather than doubled by a synthetic one.
    const existing = t.names.flatMap(n => TAGGER_POLICY.tags.filter(p => (p.dimension === DIMENSION_OF[n.group] && p.decides.includes(n.label)) || p.alsoDecides?.some(a => a.dimension === DIMENSION_OF[n.group] && a.label === n.label)));
    const output = taggerClasses.includes(`cat:${t.label}`) ? `cat:${t.label}` : taggerClasses.includes(t.label) ? t.label : undefined;
    if (existing.length) for (const p of existing) run(existing.length > 1 ? `tagger:${p.output}` : 'tagger', c => ({ taggerThreshold: { [p.output]: c } }), TAGGER_GRID, `move the shipped ${p.output} cutoff (today ${p.threshold})${p.label !== t.label ? `; shows as ${t.label}` : ''}`);
    else if (output) run('tagger', c => ({ taggerAdd: [{ output, label: t.label, dimension: t.dimension, threshold: c, decides: [t.label], tested: true, long: { rule: 'detectors', afterSeconds: 30 } }] }), TAGGER_GRID, `let the tagger's ${output} output decide ${t.label} (clips up to 30 s), like finger snap`);
    for (const [i, n] of t.names.entries()) {
      const k = `${n.group}:${n.label}`, suffix = i === 0 ? '' : `:${k}`, shown = i === 0 ? '' : `; shows as ${t.label}`;
      const head = learned!.heads?.find(h => `${h.group}:${h.label}` === k);
      if (head) run(`clap-head${suffix}`, c => ({ headThreshold: { [k]: c } }), HEAD_GRID, `move the learned.json ${i === 0 ? '' : 'merged '}${n.label} head cutoff (today ${head.threshold}${head.maybe ? ', maybe' : ''})${shown}`);
      const short = shortClip!.heads.find(h => `${h.group}:${h.label}` === k);
      if (short) run(`one-shot-head${suffix}`, c => ({ shortThreshold: { [k]: c } }), HEAD_GRID, `move the short-clip.json ${i === 0 ? '' : 'merged '}${n.label} head cutoff (today ${short.threshold}); only clips of at most ${SHORT_CLIP_MAX_SECONDS} s change${shown}`);
    }
    if (!Object.keys(out).length) console.log(`\n== ${t.input}: no tagger output, head or one-shot head exists; nothing to sweep ==`);
  }
  const durations = records.map(r => r.duration).sort((a, b) => a - b);
  report.durations = { min: durations[0], median: durations[Math.floor(durations.length / 2)], max: durations.at(-1), oneShots: durations.filter(d => d <= SHORT_CLIP_MAX_SECONDS).length };
  if (outPath) { mkdirSync(dirname(resolve(outPath)), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 1)); console.log(`\nreport: ${outPath}`); }
}
const DIMENSION_OF: Record<DjGroup, 'source' | 'effect' | 'character'> = { source: 'source', production: 'effect', character: 'character' };
const fmt = (v: number | null | undefined) => v === null || v === undefined ? '  —  ' : v.toFixed(3);

if (!flag('decide-only')) await scorePhase();
if (!flag('score-only')) decidePhase();
