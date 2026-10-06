import { STRUCTURE_RATE } from './structure';

/** A synthetic 128 BPM arrangement: each part switches kick, bass and a pad on or off. */
export function arrangement(parts: { seconds: number; kick: boolean; bass: boolean; pad: boolean }[]) {
  const total = parts.reduce((n, p) => n + p.seconds, 0), out = new Float32Array(Math.round(total * STRUCTURE_RATE));
  const beat = 60 / 128;
  let t0 = 0, seed = 1;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (const p of parts) {
    const from = Math.round(t0 * STRUCTURE_RATE), to = Math.round((t0 + p.seconds) * STRUCTURE_RATE);
    for (let i = from; i < to; i++) {
      const t = i / STRUCTURE_RATE, sinceBeat = t % beat;
      let v = 0;
      if (p.kick) v += 0.6 * Math.exp(-sinceBeat * 18) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-sinceBeat * 30)) * sinceBeat);
      if (p.bass) v += 0.35 * Math.sin(2 * Math.PI * 55 * t) * (sinceBeat > 0.1 ? 1 : 0.3);
      if (p.pad) v += 0.08 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554 * t)) + 0.01 * noise();
      out[i] = v;
    }
    t0 += p.seconds;
  }
  return out;
}
