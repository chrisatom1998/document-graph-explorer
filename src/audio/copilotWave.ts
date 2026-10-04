export const TRANSCRIPTION_SECONDS = 30;
export const TRANSCRIPTION_RATE = 16000;
export const MAX_TRANSCRIPTION_BYTES = 44 + TRANSCRIPTION_SECONDS * TRANSCRIPTION_RATE * 2;

/** Canonical mono PCM makes the upload duration independently verifiable. */
export function copilotWave(samples: Float32Array): ArrayBuffer {
  const length = Math.min(samples.length, TRANSCRIPTION_RATE * TRANSCRIPTION_SECONDS);
  if (!length) throw Error('No audio samples found.');
  const data = new ArrayBuffer(44 + length * 2);
  const view = new DataView(data);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TRANSCRIPTION_RATE, true); view.setUint32(28, TRANSCRIPTION_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0)) * 32767), true);
  return data;
}

export function validateCopilotWave(data: Uint8Array): number {
  if (data.byteLength <= 44 || data.byteLength > MAX_TRANSCRIPTION_BYTES || data.byteLength % 2) throw Error('Upload a nonempty audio excerpt of at most 30 seconds.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = (offset: number, value: string) => [...value].every((s, i) => view.getUint8(offset + i) === s.charCodeAt(0));
  if (!text(0, 'RIFF') || !text(8, 'WAVE') || !text(12, 'fmt ') || !text(36, 'data') ||
      view.getUint32(4, true) !== data.byteLength - 8 || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== TRANSCRIPTION_RATE ||
      view.getUint32(28, true) !== TRANSCRIPTION_RATE * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 ||
      view.getUint32(40, true) !== data.byteLength - 44) throw Error('Expected a 16 kHz mono PCM excerpt.');
  return (data.byteLength - 44) / (TRANSCRIPTION_RATE * 2);
}
