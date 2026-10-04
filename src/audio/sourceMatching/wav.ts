import type { PcmAudio } from './fingerprint';

/** Channel-preserving bounded PCM WAV decoder. Returns null for other codecs. */
export function decodePcmWav(bytes: Uint8Array, startSeconds = 0, seconds = 4): PcmAudio | null {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(seconds) || seconds < 0.25 || seconds > 20) throw new Error('Choose a clip between 0.25 and 20 seconds.');
  const name = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  if (bytes.length < 12 || name(0, 4) !== 'RIFF' || name(8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0; let channels = 0; let bits = 0; let format = 0; let alignment = 0; let dataOffset = 0; let dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true); const body = offset + 8;
    if (body + size > bytes.length) throw new Error('WAV contains a truncated audio chunk.');
    const chunk = name(offset, 4);
    if (chunk === 'fmt ') {
      if (size < 16) throw new Error('WAV format is incomplete.');
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true); rate = view.getUint32(body + 4, true); alignment = view.getUint16(body + 12, true); bits = view.getUint16(body + 14, true);
      if (format === 65534) {
        if (size < 40 || view.getUint16(body + 16, true) < 22) throw new Error('WAV extended format is incomplete.');
        // PCM/IEEE-float subformat GUIDs have this fixed tail.
        const expected = [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
        if (!expected.every((v, i) => view.getUint8(body + 28 + i) === v)) return null;
        format = view.getUint32(body + 24, true);
      }
    } else if (chunk === 'data' && !dataOffset) { dataOffset = body; dataSize = size; }
    offset = body + size + size % 2;
  }
  if (![1, 3].includes(format)) return null;
  if (!Number.isInteger(rate) || rate < 8000 || rate > 384000 || channels < 1 || channels > 8 || ![8, 16, 24, 32].includes(bits) || format === 3 && bits !== 32 || alignment !== channels * bits / 8 || !dataOffset || dataSize % alignment !== 0) throw new Error('Unsupported or invalid PCM WAV format.');
  const totalFrames = dataSize / alignment; const first = Math.round(startSeconds * rate);
  const frames = Math.max(0, Math.min(totalFrames - first, Math.round(seconds * rate)));
  if (frames < rate * 0.25) throw new Error('The selected clip contains less than 0.25 seconds of audio.');
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const offset = dataOffset + (first + frame) * alignment + channel * bits / 8;
    let value: number;
    if (format === 3) value = view.getFloat32(offset, true);
    else if (bits === 8) value = (view.getUint8(offset) - 128) / 128;
    else if (bits === 16) value = view.getInt16(offset, true) / 32768;
    else if (bits === 24) { let integer = view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2) << 16; if (integer & 0x800000) integer -= 0x1000000; value = integer / 8388608; }
    else value = view.getInt32(offset, true) / 2147483648;
    if (!Number.isFinite(value)) throw new Error('Audio contains invalid samples.');
    output[channel][frame] = value;
  }
  return { sampleRate: rate, channels: output };
}
