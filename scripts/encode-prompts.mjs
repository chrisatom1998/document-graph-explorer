// Encodes extra CLAP text prompts one at a time (batching changes quantized vectors) with the shipped
// text model revision. Input {label: [prompt, ...]}; output {label: [{prompt, vector}]}. Offline cache only.
// Usage: node scripts/encode-prompts.mjs <in.json> <out.json>
import { readFile, writeFile } from 'node:fs/promises';
import { AutoTokenizer, ClapTextModelWithProjection } from '@huggingface/transformers';
const [IN, OUT] = process.argv.slice(2);
const manifest = JSON.parse(await readFile('public/sound-model/manifest.json', 'utf8'));
const repository = `./artifacts/music-evaluation/clap-cache/${manifest.repository}`;
const options = { revision: manifest.revision, dtype: 'q8', cache_dir: 'artifacts/music-evaluation/clap-cache', local_files_only: true };
const tokenizer = await AutoTokenizer.from_pretrained(repository, options);
const model = await ClapTextModelWithProjection.from_pretrained(repository, options);
const input = JSON.parse(await readFile(IN, 'utf8')); const out = {};
for (const [label, prompts] of Object.entries(input)) {
  out[label] = [];
  for (const prompt of prompts) {
    const { text_embeds } = await model(tokenizer([prompt], { padding: true, truncation: true }));
    out[label].push({ prompt, vector: Array.from(text_embeds.data.slice(0, 512)) });
  }
}
await writeFile(OUT, JSON.stringify(out));
console.log(Object.keys(out).length, 'labels,', Object.values(out).flat().length, 'prompts');
