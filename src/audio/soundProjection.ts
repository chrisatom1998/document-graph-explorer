import trained from './soundProjection.json';
/** Learned "sounds alike" projection (scripts/sound-alike/train.py): int8 layers mapping a unit CLAP fingerprint to a
 * space where tracks sharing genre, mood and instruments sit closer. The compared vector is
 * [sqrt(1 - mix) * fingerprint, sqrt(mix) * unit(projection)], so its cosine blends raw and learned similarity. */
interface Layer { rows: number; cols: number; weights: string; scale: number[]; bias: number[] }
export interface SoundProjection { inputDim: number; outputDim: number; activation: 'gelu' | null; mix: number; neighbors: number; floor: number; layers: Layer[] }
export const SOUND_PROJECTION = trained as SoundProjection;
const decode = (base64: string) => {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const gelu = (x: number) => .5 * x * (1 + Math.tanh(.7978845608 * (x + .044715 * x ** 3)));
const cache = new WeakMap<SoundProjection, { rows: number; cols: number; w: Float32Array; bias: number[] }[]>();
function decoded(p: SoundProjection) {
  const hit = cache.get(p);
  if (hit) return hit;
  const net = p.layers.map(l => {
    const q = decode(l.weights), w = new Float32Array(q.length);
    for (let r = 0; r < l.rows; r++) for (let c = 0; c < l.cols; c++) w[r * l.cols + c] = q[r * l.cols + c] * l.scale[r];
    return { rows: l.rows, cols: l.cols, w, bias: l.bias };
  });
  cache.set(p, net);
  return net;
}
/** The vector the sound-alike cosine compares, from a unit-length fingerprint; unchanged when mix is 0 or sizes differ. */
export function soundVector(fingerprint: number[], p: SoundProjection = SOUND_PROJECTION): number[] {
  if (!(p.mix > 0) || fingerprint.length !== p.inputDim) return fingerprint;
  const net = decoded(p);
  let x = fingerprint;
  net.forEach((l, i) => {
    const y = new Array<number>(l.rows);
    for (let r = 0; r < l.rows; r++) {
      let s = l.bias[r];
      for (let c = 0; c < l.cols; c++) s += l.w[r * l.cols + c] * x[c];
      y[r] = i < net.length - 1 && p.activation === 'gelu' ? gelu(s) : s;
    }
    x = y;
  });
  const norm = Math.hypot(...x);
  if (!Number.isFinite(norm) || norm < 1e-8) return fingerprint;
  const raw = Math.sqrt(1 - p.mix), learned = Math.sqrt(p.mix) / norm;
  return [...fingerprint.map(v => v * raw), ...x.map(v => v * learned)];
}
