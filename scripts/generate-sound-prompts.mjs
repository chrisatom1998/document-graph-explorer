// Regenerate the checked-in CLAP description vectors. No user audio is involved.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AutoTokenizer, ClapTextModelWithProjection } from '@huggingface/transformers';
const root = 'public/sound-model';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const prompts = JSON.parse(await readFile('scripts/sound-profile-prompts.json', 'utf8'));
const catalog = JSON.parse(await readFile('src/audio/djCatalog.json', 'utf8'));
for (const category of catalog.categories) {
  if (!prompts.some(p => p.group === category.axis && p.label === category.label)) {
    prompts.push({group: category.axis, label: category.label, prompt: category.description});
  }
}
const existingAxes = new Set(['source','articulation','tone','space','role','vocal','sample','dj-type','breath','dj-tone','dj-rhythm']);
const anchors = prompts.filter(p => p.group === 'dj-type' && p.label && p.label !== 'vocal breath');
for (const axis of new Set(catalog.categories.map(c => c.axis))) {
  if (existingAxes.has(axis)) continue;
  const competitors = [
    'Silence with no identifiable sound.',
    'A mixture of unrelated sounds without a clearly identifiable ' + axis.slice(3) + ' sound.',
    ...anchors.filter(p => !catalog.categories.some(c => c.axis === axis && c.label === p.label)).map(p => p.prompt),
  ];
  for (const prompt of competitors) {
    if (!prompts.some(p => p.group === axis && p.prompt === prompt)) prompts.push({group:axis,label:null,prompt});
  }
}
const repository = process.argv.includes('--offline') ? `./artifacts/music-evaluation/clap-cache/${manifest.repository}` : manifest.repository;
const options = { revision: manifest.revision, dtype: 'q8', cache_dir: 'artifacts/music-evaluation/clap-cache' };
const tokenizer = await AutoTokenizer.from_pretrained(repository, options);
const model = await ClapTextModelWithProjection.from_pretrained(repository, options);
try {
  // Preserve the shipped axes' original batching. Quantized text embeddings
  // vary with padding/batch shape; new sample prompts are encoded individually
  // so adding an unrelated description cannot change their vectors.
  const legacyGroups = new Set(['source','articulation','tone','space','role','vocal']);
  const legacy = prompts.filter(p => legacyGroups.has(p.group));
  const inputs = tokenizer(legacy.map(p => p.prompt), { padding: true, truncation: true });
  const { text_embeds: embeddings } = await model(inputs);
  for (let i = 0; i < legacy.length; i++) legacy[i].vector = Array.from(embeddings.data.slice(i * 512, (i + 1) * 512));
  for (const prompt of prompts.filter(p => !legacyGroups.has(p.group))) {
    const { text_embeds } = await model(tokenizer(prompt.prompt, { padding: true, truncation: true }));
    prompt.vector = Array.from(text_embeds.data);
  }
  const output = JSON.stringify(prompts);
  await writeFile(`${root}/prompts.json`, output);
  await writeFile('scripts/sound-profile-prompts.json', JSON.stringify(prompts.map(p => ({group:p.group,label:p.label,prompt:p.prompt})), null, 2) + '\n');
  manifest.catalogVersion = catalog.version;
  manifest.sha256['prompts.json'] = createHash('sha256').update(output).digest('hex');
  await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
} finally { await model.dispose(); }
