// Node 24: local fixed-policy comparison, never audio inference or threshold fitting.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compareRevisions } from '../src/audio/evaluationComparison.ts';
const paths=process.argv.slice(2);
if(paths.length!==4) {
  console.error('Usage: node scripts/compare-audio.mjs manifest.json baseline.json candidate.json match.json');
  process.exitCode=1;
} else {
  try {
    const contents=await Promise.all(paths.map(path=>readFile(path,'utf8')));
    const [manifest,baseline,candidate,match]=contents.map(text=>JSON.parse(text));
    console.log(JSON.stringify({inputSha256:contents.map(text=>createHash('sha256').update(text).digest('hex')),...compareRevisions(manifest,baseline,candidate,match)},null,2));
  } catch(error) {console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
