import { sha256, importReferenceLibrary, validateReferenceManifest, type ReferenceManifest, type ReferenceRecord } from './referenceLibrary';
import { decodePcmWav } from './wav';
import { fingerprintInWorker, matchInWorker } from './workerClient';
import type { Candidate } from './matching';
import providedManifest from './testfixtures/reference-manifest.json';

const MAX_BYTES = 100 * 1024 * 1024;
export interface LocalReferenceLibrary { candidates: Candidate[]; files: Map<string, File>; name: string }
export type Progress = (message: string) => void;
const providedUrls: Record<string, string> = {
  'iowa-flute-first8s': new URL('./testfixtures/iowa-flute-first8s.wav', import.meta.url).href,
  'iowa-marimba-C7': new URL('./testfixtures/iowa-marimba-C7.wav', import.meta.url).href,
};
const trustedProvided = (record: ReferenceRecord) => providedManifest.records.some(expected => JSON.stringify(expected) === JSON.stringify(record));

async function decode(file: File, bytes: Uint8Array, start: number, seconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const wav = decodePcmWav(bytes, start, seconds);
  if (wav) return wav;
  const { openMusicDecoder } = await import('../decodeMusic');
  const decoder = await openMusicDecoder(file, file.name, signal);
  try {
    const length = Math.min(seconds, decoder.durationSeconds ? decoder.durationSeconds - start : seconds);
    if (length < 0.25) throw new Error('The selected clip contains less than 0.25 seconds of audio.');
    const mono = await decoder.read(start, length, 44100);
    signal?.throwIfAborted();
    return { sampleRate: 44100, channels: [mono] };
  } finally { decoder.close(); }
}

/** Read only user-selected files. Manifest URIs never cause a fetch or private-file scan. */
export async function importLocalReferenceFiles(raw: unknown, files: readonly File[], signal?: AbortSignal, progress?: Progress): Promise<LocalReferenceLibrary> {
  const errors = validateReferenceManifest(raw);
  if (errors.length) throw new Error(errors.join('; '));
  const manifest = structuredClone(raw) as ReferenceManifest;
  if (!manifest.records.length || manifest.records.length > 32 || !files.length || files.length > 64 || files.some(f => f.size > 32 * 1024 * 1024) || files.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) throw new Error('Choose 1–32 references and up to 100 MB of audio (32 MB per file).');
  const byHash = new Map<string, { file: File; bytes: Uint8Array }>();
  for (const [i, file] of files.entries()) {
    signal?.throwIfAborted(); progress?.(`Checking selected audio ${i + 1} of ${files.length}…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await sha256(bytes); signal?.throwIfAborted();
    byHash.set(hash, { file, bytes });
  }
  const byUri = new Map<string, { file: File; bytes: Uint8Array }>();
  for (const record of manifest.records) {
    const selected = byHash.get(record.asset.sha256);
    if (!selected) throw new Error(`No selected audio matches the SHA-256 for reference ${record.id}.`);
    const previous = byUri.get(record.asset.uri);
    if (previous && previous !== selected) throw new Error('One reference URI points to different audio hashes.');
    byUri.set(record.asset.uri, selected);
  }
  const imported = await importReferenceLibrary(manifest, async uri => byUri.get(uri)!.bytes, async record => trustedProvided(record));
  const candidates: Candidate[] = []; const referenceFiles = new Map<string, File>();
  for (const [i, reference] of imported.entries()) {
    signal?.throwIfAborted(); progress?.(`Preparing reference ${i + 1} of ${imported.length}…`);
    const selected = byUri.get(reference.record.asset.uri)!;
    const audio = await decode(selected.file, selected.bytes, 0, 20, signal);
    const fingerprint = await fingerprintInWorker(audio, signal);
    candidates.push({ reference, fingerprint }); referenceFiles.set(reference.record.id, selected.file);
  }
  signal?.throwIfAborted();
  return { candidates, files: referenceFiles, name: manifest.libraryId };
}

/** Same-origin bundled, reviewed acoustic recordings. No arbitrary URLs are followed. */
export async function loadProvidedReferences(signal?: AbortSignal, progress?: Progress): Promise<LocalReferenceLibrary> {
  const files: File[] = [];
  for (const record of providedManifest.records) {
    signal?.throwIfAborted(); progress?.('Loading provided University of Iowa recordings…');
    const response = await fetch(providedUrls[record.id], { signal, credentials: 'omit' });
    if (!response.ok) throw new Error('The provided reference audio could not be loaded.');
    const bytes = await response.arrayBuffer(); signal?.throwIfAborted();
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('Reference audio exceeds the local size limit.');
    files.push(new File([bytes], record.asset.uri, { type: 'audio/wav' }));
  }
  return importLocalReferenceFiles(providedManifest, files, signal, progress);
}

export async function compareLocalAudio(file: File, library: LocalReferenceLibrary, clip: { start: number; seconds: number }, signal?: AbortSignal, progress?: Progress) {
  if (!library.candidates.length) throw new Error('Load a reference library first.');
  if (file.size > 32 * 1024 * 1024) throw new Error('Choose a query audio file up to 32 MB.');
  if (!Number.isFinite(clip.start) || clip.start < 0 || !Number.isFinite(clip.seconds) || clip.seconds < 0.25 || clip.seconds > 20) throw new Error('Choose a clip between 0.25 and 20 seconds, starting at zero or later.');
  signal?.throwIfAborted(); progress?.('Checking the selected recording…');
  const bytes = new Uint8Array(await file.arrayBuffer()); const fileSha256 = await sha256(bytes);
  signal?.throwIfAborted(); progress?.('Decoding the selected clip locally…');
  const audio = await decode(file, bytes, clip.start, clip.seconds, signal);
  signal?.throwIfAborted(); progress?.('Aligning and comparing reference audio…');
  // Exact PCM is deliberately omitted; codec fallback is mono/resampled.
  return matchInWorker(audio, library.candidates, fileSha256, signal);
}

export function emptyReferenceManifest(): ReferenceManifest { return { version: 1, libraryId: 'my-local-reference-library', records: [] }; }

/** Plain local recordings can be compared without inventing source/preset metadata. */
export async function importUnlabelledAudio(files: readonly File[], signal?: AbortSignal, progress?: Progress) {
  if (!files.length || files.length > 32 || files.some(f => f.size > 32 * 1024 * 1024) || files.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) throw new Error('Choose 1–32 references and up to 100 MB of audio (32 MB per file).');
  const records: ReferenceRecord[] = [];
  for (const [i, file] of files.entries()) {
    signal?.throwIfAborted(); progress?.(`Preparing local reference metadata ${i + 1} of ${files.length}…`);
    const hash = await sha256(new Uint8Array(await file.arrayBuffer()));
    signal?.throwIfAborted();
    records.push({ id: `local-${i + 1}-${hash.slice(0, 12)}`, familyId: `local-audio-${hash}`, kind: 'original-sample', asset: { uri: `selected-file-${i + 1}`, sha256: hash }, identity: null, render: null,
      rights: { basis: 'Selected by the user for local audio comparison; source/license identity unverified.', localAnalysisAllowed: true },
      provenance: { method: 'user-attestation', evidenceUri: 'local:selected-audio', artifactSha256: hash, reviewer: 'Local file selection', reviewedAt: new Date().toISOString() } });
  }
  return importLocalReferenceFiles({ version: 1, libraryId: 'Selected local audio references', records }, files, signal, progress);
}
