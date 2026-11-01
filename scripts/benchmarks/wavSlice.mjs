// Cut a 16-bit PCM WAV down to one window. The fmt chunk is rewritten as a
// canonical PCM header so the slice does not depend on extra chunks in the source.

export function slicePcmWav(bytes, startSeconds, durationSeconds) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new Error('Expected a RIFF WAVE file');
  let at = 12;
  let format = 0, channels = 0, rate = 0, bits = 0, dataAt = -1, dataSize = 0;
  while (at + 8 <= bytes.length) {
    const id = ascii(at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      format = view.getUint16(at + 8, true);
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      dataAt = at + 8;
      dataSize = size;
      break;
    }
    at += 8 + size + (size & 1);
  }
  if (format !== 1 || bits !== 16 || channels < 1 || rate < 1 || dataAt < 0) {
    throw new Error('Only 16-bit PCM WAV slices are supported');
  }
  const frame = channels * 2;
  const startFrame = Math.round(startSeconds * rate);
  const frames = Math.round(durationSeconds * rate);
  const start = dataAt + startFrame * frame;
  const end = start + frames * frame;
  if (start < dataAt || end > dataAt + dataSize) throw new Error('Slice is outside the WAV data chunk');
  const pcm = bytes.subarray(start, end);
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * frame, 28);
  out.writeUInt16LE(frame, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}
