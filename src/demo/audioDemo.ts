import type { IngestFile } from '../model/types';

/** 32 kHz matches the timbre meter, and eight short clips stay small in memory. */
const RATE = 32_000;

type Voice = (time: number, index: number) => number;

interface AudioDemoClip {
  name: string;
  seconds: number;
  render: () => Float32Array;
}

function render(seconds: number, voice: Voice): Float32Array {
  const count = Math.max(1, Math.round(seconds * RATE));
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const sample = voice(i / RATE, i);
    samples[i] = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
  }
  return samples;
}

/** Deterministic white noise. Same index always yields the same sample. */
function hashNoise(index: number): number {
  let x = (Math.imul(index, 1103515245) + 12345) >>> 0;
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  return x / 0xffffffff * 2 - 1;
}

function pcm16Wav(samples: Float32Array): ArrayBuffer {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(data);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, data.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  }
  return data;
}

function kick(): Float32Array {
  let phase = 0;
  return render(0.4, (time) => {
    const hz = 48 + 140 * Math.exp(-time * 18);
    phase += (2 * Math.PI * hz) / RATE;
    const click = time < 0.003 ? 1 - time / 0.003 : 0;
    return (Math.sin(phase) * 0.8 + click * 0.35) * Math.exp(-time * 7);
  });
}

function snare(): Float32Array {
  let phase = 0;
  return render(0.35, (time, index) => {
    phase += (2 * Math.PI * 190) / RATE;
    return (Math.sin(phase) * 0.25 + hashNoise(index) * 0.55) * Math.exp(-time * 10);
  });
}

function hat(): Float32Array {
  return render(0.12, (time, index) => hashNoise(index * 3 + 1) * Math.exp(-time * 55) * 0.45);
}

function shaker(): Float32Array {
  const beat = 60 / 120;
  return render(beat * 4, (time, index) => {
    const pos = time % (beat / 2);
    return hashNoise(index) * Math.exp(-pos * 28) * 0.35;
  });
}

function bass(bpm: number, hz: number): Float32Array {
  let phase = 0;
  const beat = 60 / bpm;
  return render(beat * 4, (time) => {
    phase += (2 * Math.PI * hz) / RATE;
    const pos = time % beat;
    const env = Math.min(1, pos / 0.008) * Math.exp(-pos * 4);
    return Math.sin(phase) * env * (pos < beat * 0.7 ? 0.75 : 0);
  });
}

function pad(): Float32Array {
  const voices = [220, 261.63, 329.63].map((hz) => {
    let phase = 0;
    return () => {
      phase += (2 * Math.PI * hz) / RATE;
      return Math.sin(phase);
    };
  });
  return render(2.4, (time) => {
    const attack = Math.min(1, time / 0.15);
    const release = time > 2.1 ? (2.4 - time) / 0.3 : 1;
    const sum = voices.reduce((total, voice) => total + voice(), 0) / voices.length;
    return sum * attack * release * 0.6;
  });
}

function pluck(): Float32Array {
  const beat = 60 / 128;
  const notes = [293.66, 349.23, 392, 349.23];
  let phase = 0;
  return render(beat * 4, (time) => {
    const step = Math.min(notes.length - 1, Math.floor(time / beat));
    phase += (2 * Math.PI * notes[step]) / RATE;
    const pos = time % beat;
    const env = Math.min(1, pos / 0.004) * Math.exp(-pos * 5);
    return (Math.sin(phase) + Math.sin(phase * 2) * 0.25) * env * 0.55;
  });
}

/** Short generated pack: one-shots plus loops at different tempos and pitches. */
export const AUDIO_DEMO_CLIPS: readonly AudioDemoClip[] = [
  { name: 'demo-kick-one-shot.wav', seconds: 0.4, render: kick },
  { name: 'demo-snare-one-shot.wav', seconds: 0.35, render: snare },
  { name: 'demo-hat-one-shot.wav', seconds: 0.12, render: hat },
  { name: 'demo-shaker-loop-120.wav', seconds: 2, render: shaker },
  { name: 'demo-bass-loop-A-120.wav', seconds: 2, render: () => bass(120, 110) },
  { name: 'demo-bass-loop-E-140.wav', seconds: 60 / 140 * 4, render: () => bass(140, 82.41) },
  { name: 'demo-pad-loop-Am-100.wav', seconds: 2.4, render: pad },
  { name: 'demo-pluck-loop-D-128.wav', seconds: 60 / 128 * 4, render: pluck },
];

export const AUDIO_DEMO_SAMPLE_RATE = RATE;

/** Browser-local WAV clips. Bytes are real PCM, so ingest and playback both work. */
export function createAudioDemoFiles(): IngestFile[] {
  return AUDIO_DEMO_CLIPS.map((clip) => {
    const samples = clip.render();
    return {
      fileId: crypto.randomUUID(),
      name: clip.name,
      path: `demo-audio/${clip.name}`,
      fileType: 'audio',
      bytes: pcm16Wav(samples),
    };
  });
}
