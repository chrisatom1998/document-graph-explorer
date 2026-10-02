// Regenerate the checked-in CLAP description vectors. No user audio is involved.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AutoTokenizer, ClapTextModelWithProjection } from '@huggingface/transformers';
const root = 'public/sound-model';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const prompts = JSON.parse(await readFile('scripts/sound-profile-prompts.json', 'utf8'));
const repository = process.argv.includes('--offline') ? `./artifacts/music-evaluation/clap-cache/${manifest.repository}` : manifest.repository;
const options = { revision: manifest.revision, dtype: 'q8', cache_dir: 'artifacts/music-evaluation/clap-cache' };
const tokenizer = await AutoTokenizer.from_pretrained(repository, options);
const model = await ClapTextModelWithProjection.from_pretrained(repository, options);
try {
  // Preserve the shipped axes' original batching. Quantized text embeddings
  // vary with padding/batch shape; new sample prompts are encoded individually
  // so adding an unrelated description cannot change their vectors.
  const legacy = prompts.filter(p => p.group !== 'sample');
  const inputs = tokenizer(legacy.map(p => p.prompt), { padding: true, truncation: true });
  const { text_embeds: embeddings } = await model(inputs);
  for (let i = 0; i < legacy.length; i++) legacy[i].vector = Array.from(embeddings.data.slice(i * 512, (i + 1) * 512));
  for (const prompt of prompts.filter(p => p.group === 'sample')) {
    const { text_embeds } = await model(tokenizer(prompt.prompt, { padding: true, truncation: true }));
    prompt.vector = Array.from(text_embeds.data);
  }
  const output = JSON.stringify(prompts);
  await writeFile(`${root}/prompts.json`, output);
  manifest.sha256['prompts.json'] = createHash('sha256').update(output).digest('hex');
  await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
} finally { await model.dispose(); }
