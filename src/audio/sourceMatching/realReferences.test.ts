import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fingerprint, type PcmAudio } from './fingerprint';
import { importReferenceLibrary, sha256, type ReferenceManifest } from './referenceLibrary';
import { matchSource, type Candidate } from './matching';

// Test-only WAV reader, not a replacement for the app's existing decoder.
function pcmWav(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0; let channels = 0; let bits = 0; let format = 0; let offset = 0; let size = 0;
  for (let i = 12; i + 8 <= bytes.length;) {
    const name = new TextDecoder().decode(bytes.subarray(i, i + 4)); const length = view.getUint32(i + 4, true);
    if (name === 'fmt ') { format = view.getUint16(i + 8, true); channels = view.getUint16(i + 10, true); rate = view.getUint32(i + 12, true); bits = view.getUint16(i + 22, true); if (format === 65534) format = view.getUint16(i + 32, true); }
    if (name === 'data') { offset = i + 8; size = length; }
    i += 8 + length + length % 2;
  }
  if (format !== 1 || bits !== 16 || !offset || !channels || offset + size > bytes.length) throw new Error('fixture must be 16-bit PCM WAV');
  const frames = size / (2 * channels);
  return { sampleRate: rate, channels: Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, i) => view.getInt16(offset + (i * channels + channel) * 2, true) / 32768)) };
}

const fixtureDirectory = fileURLToPath(new URL('./testfixtures/', import.meta.url));
interface FixtureProvenance { references: { referenceId: string; wavSha256: string; sourcePage: string }[] }
async function provenance() {
  return JSON.parse(await readFile(join(fixtureDirectory, 'provenance.json'), 'utf8')) as FixtureProvenance;
}
async function references() {
  const raw = JSON.parse(await readFile(join(fixtureDirectory, 'reference-manifest.json'), 'utf8')) as ReferenceManifest;
  const evidence = await provenance();
  const imported = await importReferenceLibrary(raw, uri => readFile(join(fixtureDirectory, uri)), async record => {
    // Explicitly checked acquisition catalog, not an automatic trust rule for arbitrary URLs.
    const checked = evidence.references.find(ref => ref.referenceId === record.id);
    return record.provenance.method === 'publisher-documentation' && record.identity === null && checked?.sourcePage === record.provenance.evidenceUri && checked.wavSha256 === record.asset.sha256;
  });
  const audio = await Promise.all(imported.map(async reference => pcmWav(await readFile(join(fixtureDirectory, reference.record.asset.uri)))));
  const candidates: Candidate[] = imported.map((reference, i) => ({ reference, fingerprint: fingerprint(audio[i]) }));
  return { candidates, audio };
}

describe('provided first-party Iowa acoustic references (not synth presets)', () => {
  it('verifies redistributable fixture hashes and provides valid provenance with no synth identities', async () => {
    const evidence = await provenance();
    const manifest = JSON.parse(await readFile(join(fixtureDirectory, 'reference-manifest.json'), 'utf8')) as ReferenceManifest;
    for (const entry of manifest.records) {
      expect(await sha256(await readFile(join(fixtureDirectory, entry.asset.uri)))).toBe(entry.asset.sha256);
      expect(evidence.references.find(ref => ref.referenceId === entry.id)?.wavSha256).toBe(entry.asset.sha256);
    }
    const { candidates } = await references();
    expect(candidates).toHaveLength(2);
    for (const c of candidates) {
      expect(c.reference.record.identity).toBeNull();
      const result = matchSource(c.fingerprint, candidates, {}, { fileSha256: c.reference.record.asset.sha256 });
      expect(result.decision).toBe('verified-origin');
      expect(result.exact?.referenceIds).toEqual([c.reference.record.id]);
    }
  });
  it('retrieves a cropped, quiet flute excerpt using default bounded search', async () => {
    const { candidates, audio } = await references();
    const source = audio[0]; const start = Math.round(1.024 * source.sampleRate);
    const query = { sampleRate: source.sampleRate, channels: source.channels.map(c => Float32Array.from(c.subarray(start, start + source.sampleRate * 1.5), v => v * 0.2)) };
    const result = matchSource(fingerprint(query), candidates);
    expect(result.ranked[0].referenceId).toBe('iowa-flute-first8s');
    expect(result.ranked[0].components.spectral).toBeGreaterThan(0.9);
    expect(result.decision).toBe('resemblance');
  });
  it('retrieves a real flute excerpt after coupled playback pitch/time change', async () => {
    const { candidates, audio } = await references();
    const source = audio[0]; const factor = 2 ** (2 / 12); const start = source.sampleRate;
    const query = { sampleRate: source.sampleRate, channels: source.channels.map(c => Float32Array.from({ length: Math.floor(source.sampleRate * 1.5 / factor) }, (_, i) => {
      const position = start + i * factor; const floor = Math.floor(position); const weight = position - floor;
      return c[floor] * (1 - weight) + c[floor + 1] * weight;
    })) };
    const result = matchSource(fingerprint(query), candidates);
    expect(result.ranked[0].referenceId).toBe('iowa-flute-first8s');
    expect(result.ranked[0].alignment.pitchSemitones).toBe(2);
    expect(result.decision).toBe('resemblance');
  });
});
