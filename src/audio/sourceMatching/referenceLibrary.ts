/** Declarations are validated here; only an explicit evidence verifier establishes trust. */
export interface PresetIdentity { synth: string; version: string; bank: string; preset: string }
export interface ReferenceRecord {
  id: string;
  familyId: string;
  kind: 'original-sample' | 'preset-render' | 'synthetic-control';
  asset: { uri: string; sha256: string };
  rights: { basis: string; localAnalysisAllowed: true };
  identity: PresetIdentity | null;
  render: null | { midiNote: number; velocity: number; heldSeconds: number; releaseSeconds: number; sampleRate: number; channels: number; effects: { mode: 'bypassed' | 'factory' | 'processed'; settings: string }; synthSettings: string };
  provenance: { method: 'render-log' | 'publisher-documentation' | 'user-attestation' | 'synthetic-generator'; evidenceUri: string; artifactSha256: string; reviewer: string; reviewedAt: string };
}
export interface ReferenceManifest { version: 1; libraryId: string; records: ReferenceRecord[] }
export interface ImportedReference { record: ReferenceRecord; trust: 'verified' | 'declared' | 'synthetic' }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
export const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number) => number(v, min, max) && Number.isInteger(v);

export function validateReferenceManifest(raw: unknown): string[] {
  if (!object(raw)) return ['manifest must be an object'];
  const errors: string[] = [];
  if (raw.version !== 1 || !text(raw.libraryId)) errors.push('version 1 and libraryId required');
  if (!Array.isArray(raw.records)) return [...errors, 'records must be an array'];
  const ids = new Set<string>();
  const familyIdentities = new Map<string, string>();
  for (const [i, record] of raw.records.entries()) {
    const fail = (message: string) => errors.push(`record ${i}: ${message}`);
    if (!object(record)) { fail('object required'); continue; }
    if (!text(record.id) || ids.has(record.id)) fail('unique nonempty id required');
    else ids.add(record.id);
    if (!text(record.familyId)) fail('preset/sample familyId required');
    if (!['original-sample', 'preset-render', 'synthetic-control'].includes(String(record.kind))) fail('invalid kind');
    if (!object(record.asset) || !text(record.asset.uri) || !isSha256(record.asset.sha256)) fail('asset URI and lowercase SHA-256 required');
    if (!object(record.rights) || record.rights.localAnalysisAllowed !== true || !text(record.rights.basis)) fail('explicit local analysis rights required');
    if (record.kind === 'preset-render') {
      if (!object(record.identity) || !['synth', 'version', 'bank', 'preset'].every(k => text(record.identity && (record.identity as Record<string, unknown>)[k]))) fail('complete preset identity required');
    } else if (record.identity !== null) fail('only preset renders may declare synth identity');
    if (record.kind === 'original-sample') { if (record.render !== null) fail('original sample render must be null'); }
    else {
      const r = record.render;
      if (!object(r) || !integer(r.midiNote, 0, 127) || !integer(r.velocity, 1, 127) || !number(r.heldSeconds, 0.001, 3600) || !number(r.releaseSeconds, 0, 3600) || !integer(r.sampleRate, 8000, 384000) || !integer(r.channels, 1, 32) || !text(r.synthSettings) || !object(r.effects) || !['bypassed', 'factory', 'processed'].includes(String(r.effects.mode)) || !text(r.effects.settings)) fail('complete render pitch, velocity, duration, release, settings and FX required');
    }
    if (text(record.familyId) && (record.identity === null || object(record.identity))) {
      const identity = JSON.stringify([record.kind, record.identity === null ? null : ['synth', 'version', 'bank', 'preset'].map(k => (record.identity as Record<string, unknown>)[k])]);
      if (familyIdentities.has(record.familyId) && familyIdentities.get(record.familyId) !== identity) fail('inconsistent identity within family');
      familyIdentities.set(record.familyId, identity);
    }
    const p = record.provenance;
    if (!object(p) || !['render-log', 'publisher-documentation', 'user-attestation', 'synthetic-generator'].includes(String(p.method)) || !text(p.evidenceUri) || !text(p.reviewer) || !text(p.reviewedAt) || !Number.isFinite(Date.parse(p.reviewedAt)) || !isSha256(p.artifactSha256) || !object(record.asset) || p.artifactSha256 !== record.asset.sha256) fail('hash-bound dated provenance required');
    if (object(p) && (record.kind === 'synthetic-control') !== (p.method === 'synthetic-generator')) fail('synthetic provenance/kind mismatch');
  }
  return errors;
}

/** Supplied bytes must match. No fetch, filename parsing, or implicit trust is performed. */
export async function importReferenceLibrary(raw: unknown, readAsset: (uri: string) => Promise<Uint8Array>, verifyEvidence?: (record: ReferenceRecord) => Promise<boolean>): Promise<ImportedReference[]> {
  const errors = validateReferenceManifest(raw);
  if (errors.length) throw new Error(errors.join('; '));
  const manifest = structuredClone(raw) as ReferenceManifest;
  const imported: ImportedReference[] = [];
  for (const record of manifest.records) {
    if (await sha256(await readAsset(record.asset.uri)) !== record.asset.sha256) throw new Error(`asset hash mismatch: ${record.id}`);
    const trust = record.kind === 'synthetic-control' ? 'synthetic' : record.provenance.method !== 'user-attestation' && await verifyEvidence?.(record) ? 'verified' : 'declared';
    imported.push({ record, trust });
  }
  return imported;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Versioned exact decoded-PCM hash: preserves rate, channel order, and every float. */
export async function hashPcm(sampleRate: number, channels: readonly Float32Array[]): Promise<string> {
  if (!integer(sampleRate, 1, 384000) || !channels.length || channels.some(c => c.length !== channels[0].length || c.some(v => !Number.isFinite(v)))) throw new Error('invalid PCM');
  const bytes = new Uint8Array(16 + channels.length * channels[0].length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true); view.setUint32(4, sampleRate, true); view.setUint32(8, channels.length, true); view.setUint32(12, channels[0].length, true);
  let offset = 16;
  for (const channel of channels) for (const sample of channel) { view.setFloat32(offset, sample === 0 ? 0 : sample, true); offset += 4; }
  return sha256(bytes);
}

/** Coverage is reported separately: a valid single render is not a robust preset library. */
export function auditPresetCoverage(references: ImportedReference[]) {
  const groups = new Map<string, ImportedReference[]>();
  for (const ref of references) if (ref.record.kind === 'preset-render') {
    const group = groups.get(ref.record.familyId) ?? []; group.push(ref); groups.set(ref.record.familyId, group);
  }
  return [...groups].map(([familyId, refs]) => {
    const renders = refs.map(ref => ref.record.render!);
    const pitches = [...new Set(renders.map(r => r.midiNote))].sort((a, b) => a - b);
    const velocities = [...new Set(renders.map(r => r.velocity))].sort((a, b) => a - b);
    const heldSeconds = [...new Set(renders.map(r => r.heldSeconds))].sort((a, b) => a - b);
    const effectModes = [...new Set(renders.map(r => r.effects.mode))];
    const warnings: string[] = [];
    if (refs.some(ref => ref.trust !== 'verified')) warnings.push('Unverified render provenance');
    if (pitches.length < 2) warnings.push('At least two pitches needed');
    if (velocities.length < 2) warnings.push('At least two velocities needed');
    if (heldSeconds.length < 2) warnings.push('At least two held-note durations needed');
    if (renders.some(r => r.releaseSeconds <= 0)) warnings.push('Release tails missing');
    if (!effectModes.includes('factory') || !effectModes.includes('bypassed')) warnings.push('Factory and effects-bypassed recordings needed where available');
    return { familyId, renders: renders.length, pitches, velocities, heldSeconds, effectModes, readyForCalibration: warnings.length === 0, warnings };
  });
}
