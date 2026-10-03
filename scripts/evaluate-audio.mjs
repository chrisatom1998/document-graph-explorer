// Node 24 strips TypeScript types; this entry point never loads audio or models.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reviewWorkload } from '../src/audio/evaluationComparison.ts';
import { evaluateLabels } from '../src/audio/evaluation.ts';

const [manifestPath, predictionsPath, split = 'test'] = process.argv.slice(2);
if (!manifestPath || !predictionsPath || !['train', 'calibration', 'test'].includes(split)) {
  console.error('Usage: node scripts/evaluate-audio.mjs manifest.json predictions.json [test|calibration|train]');
  process.exitCode = 1;
} else {
  try {
    const manifestText = await readFile(manifestPath, 'utf8');
    const predictionsText = await readFile(predictionsPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    const predictions = JSON.parse(predictionsText);
    if (!Array.isArray(predictions)) throw new Error('predictions must be an array');
    const fingerprint = text => createHash('sha256').update(text).digest('hex');
    console.log(JSON.stringify({ manifestSha256: fingerprint(manifestText), predictionsSha256: fingerprint(predictionsText), ...evaluateLabels(manifest, predictions, split), reviewWorkload: reviewWorkload(manifest, predictions, split) }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
