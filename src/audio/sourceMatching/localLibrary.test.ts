import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, it, vi } from 'vitest';
import { fingerprint } from './fingerprint';
import { matchSource } from './matching';
import { sha256, type ReferenceManifest } from './referenceLibrary';
import { decodePcmWav } from './wav';

const workers = vi.hoisted(() => ({ fingerprint: vi.fn(), match: vi.fn() }));
vi.mock('./workerClient', () => ({ fingerprintInWorker: workers.fingerprint, matchInWorker: workers.match }));
import { compareLocalAudio, importLocalReferenceFiles, importUnlabelledAudio } from './localLibrary';
const fixtureDirectory = fileURLToPath(new URL('./testfixtures/', import.meta.url));
const fixtureFile = async (name = 'iowa-flute-first8s.wav') => new File([new Uint8Array(await readFile(`${fixtureDirectory}/${name}`))], name, { type: 'audio/wav' });
const manifest = async () => JSON.parse(await readFile(`${fixtureDirectory}/reference-manifest.json`, 'utf8')) as ReferenceManifest;
beforeEach(() => {
  workers.fingerprint.mockReset().mockImplementation(async audio => fingerprint(audio));
  workers.match.mockReset().mockImplementation(async (audio, candidates, hash) => matchSource(fingerprint(audio), candidates, {}, { fileSha256: hash }));
});

it('imports real hash-bound selected references and compares an exact reviewed artifact', async () => {
  const refs = await manifest(); const files = [await fixtureFile(), await fixtureFile('iowa-marimba-C7.wav')];
  const library = await importLocalReferenceFiles(refs, files);
  expect(library.candidates).toHaveLength(2);
  expect(library.candidates.every(candidate => candidate.reference.trust === 'verified')).toBe(true);
  const result = await compareLocalAudio(files[0], library, { start: 0, seconds: 4 });
  expect(result.decision).toBe('verified-origin');
  expect(workers.match).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100 }), library.candidates, refs.records[0].asset.sha256, undefined);
});
it('matches selected bytes independently of filenames without inferring a synth identity', async () => {
  const file = await fixtureFile(); const renamed = new File([await file.arrayBuffer()], 'Vendor secret preset.wav');
  const library = await importUnlabelledAudio([renamed]);
  expect(library.candidates[0].reference.record.identity).toBeNull();
  expect(library.candidates[0].reference.trust).toBe('declared');
  expect((await compareLocalAudio(renamed, library, { start: 0, seconds: 4 })).decision).toBe('resemblance');
});
it('does not fetch manifest URIs and rejects unmatched hashes before starting a worker', async () => {
  const refs = await manifest(); const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external fetch forbidden'));
  try {
    await expect(importLocalReferenceFiles(refs, [new File(['wrong audio'], 'iowa-flute-first8s.wav')])).rejects.toThrow('No selected audio matches');
    expect(fetch).not.toHaveBeenCalled(); expect(workers.fingerprint).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
it('fails malformed/oversized/aborted imports without returning a partial library', async () => {
  await expect(importLocalReferenceFiles({}, [])).rejects.toThrow('version');
  await expect(importUnlabelledAudio([])).rejects.toThrow('1–32');
  const big = { size: 33 * 1024 * 1024 } as File;
  await expect(importUnlabelledAudio([big])).rejects.toThrow('32 MB');
  const controller = new AbortController(); controller.abort();
  await expect(importUnlabelledAudio([await fixtureFile()], controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  expect(workers.fingerprint).not.toHaveBeenCalled();
});
it('preserves stereo in native WAV decoding and bounds selected clips', async () => {
  const bytes = new Uint8Array(await (await fixtureFile('iowa-marimba-C7.wav')).arrayBuffer());
  const audio = decodePcmWav(bytes, 0, 20)!;
  expect(audio.sampleRate).toBe(96000); expect(audio.channels).toHaveLength(2); expect(audio.channels[0]).toHaveLength(221184);
  expect(decodePcmWav(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(() => decodePcmWav(bytes, 3, 1)).toThrow('less than');
  expect(() => decodePcmWav(bytes, 0, 21)).toThrow('20 seconds');
  expect(() => decodePcmWav(bytes.subarray(0, 100))).toThrow();
});
it('rejects conflicting asset URIs even when all selected file hashes are valid', async () => {
  const refs = await manifest(); refs.records[1].asset.uri = refs.records[0].asset.uri;
  await expect(importLocalReferenceFiles(refs, [await fixtureFile(), await fixtureFile('iowa-marimba-C7.wav')])).rejects.toThrow('different audio hashes');
});
it('keeps custom preset identity declared even when metadata is complete', async () => {
  const file = await fixtureFile(); const hash = await sha256(new Uint8Array(await file.arrayBuffer()));
  const refs = await manifest(); const source = refs.records[0];
  source.kind = 'preset-render'; source.identity = { synth: 'TEST ONLY', version: '0', bank: 'unverified test', preset: 'test' };
  source.render = { midiNote: 60, velocity: 85, heldSeconds: 1, releaseSeconds: 0.5, sampleRate: 44100, channels: 1, synthSettings: 'test only', effects: { mode: 'factory', settings: 'test only' } };
  source.provenance.method = 'render-log'; source.asset.sha256 = hash; source.provenance.artifactSha256 = hash; refs.records = [source];
  const library = await importLocalReferenceFiles(refs, [file]);
  expect(library.candidates[0].reference.trust).toBe('declared');
  expect((await compareLocalAudio(file, library, { start: 0, seconds: 4 })).decision).toBe('resemblance');
});
it('does not publish decode progress after cancellation during a file read', async () => {
  const file = await fixtureFile(); const library = await importUnlabelledAudio([file]); const bytes = await file.arrayBuffer();
  let finish: (bytes: ArrayBuffer) => void = () => {};
  vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController(); const progress = vi.fn();
  const pending = compareLocalAudio(file, library, { start: 0, seconds: 4 }, controller.signal, progress);
  controller.abort(); finish(bytes);
  await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  expect(progress.mock.calls).toEqual([['Checking the selected recording…']]); expect(workers.match).not.toHaveBeenCalled();
});
