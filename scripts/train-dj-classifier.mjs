// Usage: node scripts/train-dj-classifier.mjs <Shadow sample folder> [output folder]
// All processing is local. The result is a candidate, never auto-deployed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers';
import { inventory, groupDuplicates, LABELS } from './dj-training/dataset.mjs';
import { normalize, trainBinary, evaluateByFamily, predict } from './dj-training/learning.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (!process.argv[2]) throw new Error('Usage: node scripts/train-dj-classifier.mjs <Shadow sample folder> [output folder]');
const root = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? join(repo, 'artifacts/music-evaluation/dj-training'));
await mkdir(output, { recursive: true });
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const files = await inventory(root);
await save('inventory.json', { pack: 'Shadow UK Bass Vol 1', files });
const manifest = JSON.parse(await readFile(join(repo, 'public/sound-model/manifest.json'), 'utf8'));
const modelHash = manifest.sha256['onnx/audio_model_quantized.onnx'];
const preprocessingHash = manifest.sha256['preprocessor_config.json'];
// Check local weights before treating an existing feature cache as compatible.
for (const asset of ['onnx/audio_model_quantized.onnx', 'preprocessor_config.json']) {
  const actual = createHash('sha256').update(await readFile(join(repo, 'public/sound-model', asset))).digest('hex');
  if (actual !== manifest.sha256[asset]) throw new Error(`Model asset differs from manifest: ${asset}`);
}
const extraction = { version: 1, modelHash, preprocessingHash, sampleRate: 48000, windowSeconds: 10, hopSeconds: 5, pooling: 'normalize(mean(normalized-window-embeddings))' };
const cacheFile = join(output, 'features.json');
let cached = {};
try {
  const previous = JSON.parse(await readFile(cacheFile, 'utf8'));
  if (JSON.stringify(previous.extraction) === JSON.stringify(extraction)) cached = previous.features;
} catch { /* First run has no feature cache. */ }

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = join(repo, 'public/');
const processor = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const model = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true });
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
async function embedding(samples) {
  const inputs = await processor(samples);
  let outputs;
  try {
    outputs = await model(inputs);
    return normalize(Array.from(outputs.audio_embeds.data));
  } finally {
    for (const tensor of [...Object.values(inputs), ...Object.values(outputs ?? {})]) if (typeof tensor?.dispose === 'function') await tensor.dispose();
  }
}
const rows = [];
try {
  for (const [index, file] of files.entries()) {
    if (file.excluded) continue;
    try {
      let feature = cached[file.sha256];
      if (!feature) {
        const path = join(root, file.path);
        const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { encoding: 'utf8', timeout: 30_000 }));
        const duration = Number(probe.format?.duration);
        if (!(duration > 0 && duration <= 600)) throw new Error('Expected a sample of up to ten minutes');
        const starts = [];
        const last = Math.max(0, duration - 10);
        for (let start = 0; start <= last; start += 5) starts.push(start);
        if (last - starts.at(-1) > 0.05) starts.push(last);
        const vectors = [];
        for (const start of starts) {
          const pcm = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(start), '-i', path, '-t', '10', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 4_000_000, timeout: 30_000 });
          const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
          const samples = Float32Array.from({ length: pcm.byteLength / 4 }, (_, i) => view.getFloat32(i * 4, true));
          if (samples.reduce((sum, value) => sum + value * value, 0) / samples.length < 1e-8) continue;
          vectors.push(await embedding(samples));
        }
        if (!vectors.length) throw new Error('No audible samples');
        feature = { duration, windows: vectors.length, vector: normalize(vectors[0].map((_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length)) };
        cached[file.sha256] = feature;
        await save('features.json', { extraction, features: cached });
      }
      rows.push({ ...file, ...feature });
      console.log(`[${index + 1}/${files.length}] Extracted ${file.path}`);
    } catch (error) {
      file.excluded = `Decode/inference failed: ${error.message}`;
      console.log(`Excluded ${file.path}: ${file.excluded}`);
    }
  }
  // Independent synthetic negative, never used for fitting or threshold tuning.
  let random = 42;
  const noise = Float32Array.from({ length: 48000 * 2 }, () => {
    random = (Math.imul(1664525, random) + 1013904223) >>> 0;
    return (random / 0xffffffff * 2 - 1) * 0.2;
  });
  const noiseVector = await embedding(noise);
  const grouped = groupDuplicates(rows);
  const training = grouped.filter(row => Object.keys(row.targets).length);
  const heads = LABELS.map(label => trainBinary(training, label)).filter(Boolean);
  if (!heads.length) throw new Error('No trainable labels found');
  const validation = evaluateByFamily(training, LABELS);
  const candidate = {
    format: 'dge-dj-linear-heads-v1', status: 'experimental-not-deployed',
    baseModel: { repository: manifest.repository, revision: manifest.revision }, extraction,
    training: { pack: 'Shadow UK Bass Vol 1', clips: training.length, families: new Set(training.map(row => row.family)).size,
      method: 'class-balanced L2 logistic regression; frozen CLAP audio encoder', labelProvenance: 'Owner-confirmed melodic synths; explicit vocal/breath filenames; generic chops and unknown sources excluded', epochs: 1000, regularization: 0.01 },
    heads,
  };
  const report = {
    training: candidate.training,
    excluded: files.filter(file => file.excluded).map(({ path, excluded }) => ({ path, reason: excluded })),
    unreviewed: grouped.filter(row => !Object.keys(row.targets).length).map(row => row.path),
    counts: Object.fromEntries(heads.map(head => [head.label, { positives: head.positives, negatives: head.negatives }])),
    validation: { method: 'leave-one-family-out; numbered variants and near duplicates grouped', independentPacks: 0, labels: validation },
    negativeControl: { name: 'synthetic white noise, seed 42', scores: Object.fromEntries(heads.map(head => [head.label, predict(head, noiseVector)])) },
    deployment: 'Not deployed: no independently reviewed held-out pack; generic chops are not vocal-chop training examples. Scores are not calibrated probabilities.',
  };
  await save('inventory.json', { pack: 'Shadow UK Bass Vol 1', files });
  await save('training-set.json', { extraction, rows: grouped });
  await save('candidate.json', candidate);
  await save('evaluation.json', report);
  await save('predictions.json', grouped.map(row => ({ path: row.path, targets: row.targets, scores: Object.fromEntries(heads.map(head => [head.label, predict(head, row.vector)])) })));
  const percent = value => value === null ? 'Not measurable' : `${Math.round(value * 100)}%`;
  const lines = [
    '# First DJ sound classifier — Shadow UK Bass Vol 1', '',
    `Trained a small classifier on ${training.length} clips from one pack, using the existing CLAP audio features. The large CLAP model was not retrained.`, '',
    '**Status: experimental; not active in the app.** The independent white-noise check was labeled as synthesizer. More varied negative examples and a separately reviewed sample pack are needed before release.', '',
    '## What was used', '',
    '- 16 melodic samples: synthesizer, as confirmed by the owner.',
    '- Explicit Vocal/VOX filenames supply broad voice labels; only explicitly named breaths supply positive production-type labels.',
    '- Generic CHOP filenames and unnamed samples do not establish a vocal source and are excluded from voice/vocal-chop training.',
    '- Uncertain production labels are left unknown, not treated as absent.',
    '- Seven bass-loop files are not WAV audio payloads. One bass shot has no confirmed label. Hidden metadata files are ignored.', '',
    '## Tests on samples left out of each training run', '',
    'Numbered variants, identical files, and near-duplicate audio were kept in the same group. This is a small same-pack check, not accuracy on new sample packs.', '',
    '| Label | Positive clips tested | Precision | Recall | Complete evaluation? |',
    '| --- | ---: | ---: | ---: | --- |',
    ...Object.entries(validation).map(([label, result]) => `| ${label} | ${result.positiveTests} | ${percent(result.precision)} | ${percent(result.recall)} | ${result.complete ? 'Yes, within this pack' : 'No — missing independent positive examples'} |`), '',
    'The owner corrected the tracks to generic chops. They are not labeled as vocal chops; there are no remaining positive vocal-chop examples, so that classifier is omitted.', '',
    '## Saved locally', '',
    '- `candidate.json`: trained weights, model version, and preprocessing contract.',
    '- `training-set.json`: audio features and label provenance; no audio files copied.',
    '- `inventory.json`: included/excluded files and original-file hashes.',
    '- `evaluation.json`: predictions for each held-out sample and the noise control.',
    '- `features.json`: cached audio features to make repeat training quicker.', '',
    '**Next:** provide another pack containing independently labeled vocal chops, breaths, synths, drums and noise/effects. Keep a portion completely separate for final testing.', '',
  ];
  await writeFile(join(output, 'REPORT.md'), lines.join('\n'));
  console.log(JSON.stringify({ training: report.training, counts: report.counts, validation: Object.fromEntries(Object.entries(validation).map(([label, result]) => [label, { tested: result.tested, positiveTests: result.positiveTests, precision: result.precision, recall: result.recall, complete: result.complete }])), negativeControl: report.negativeControl, deployment: report.deployment }, null, 2));
} finally { await model.dispose(); }
