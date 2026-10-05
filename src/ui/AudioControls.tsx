import { useEffect, useState } from 'react';
import { clockTime as time } from './clockTime';


/** Real sample peaks, never decorative/random waveform data. */
export function useWaveform(blob: Blob | null) {
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    setPeaks([]);
    if (!blob || typeof AudioContext === 'undefined') return;
    let cancelled = false;
    const context = new AudioContext();
    void (async () => {
      try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        if (cancelled) return;
        const channel = audio.getChannelData(0);
        const buckets = 100;
        const values = Array.from({ length: buckets }, (_, index) => {
          const start = Math.floor(index * channel.length / buckets);
          const end = Math.floor((index + 1) * channel.length / buckets);
          let peak = 0;
          // Bound work for long tracks without retaining the decoded buffer.
          const step = Math.max(1, Math.floor((end - start) / 400));
          for (let i = start; i < end; i += step) peak = Math.max(peak, Math.abs(channel[i]));
          return peak;
        });
        setPeaks(values);
      } catch { /* Unsupported codecs keep a plain seek bar; conversion remains available. */ }
      finally { if (context.state !== 'closed') void context.close().catch(() => {}); }
    })();
    return () => { cancelled = true; if (context.state !== 'closed') void context.close().catch(() => {}); };
  }, [blob]);
  return peaks;
}

export interface AudioControlState {
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  available: boolean;
  peaks: number[];
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
}

export default function AudioControls({ state, dock = false }: { state: AudioControlState; dock?: boolean }) {
  const ratio = state.duration > 0 ? state.currentTime / state.duration : 0;
  return <div className={`audio-controls audio-controls--${dock ? 'dock' : 'preview'}`}>
    <button type="button" className="audio-play" aria-label={state.playing ? 'Pause sample' : 'Play sample'} onClick={state.onToggle} disabled={!state.available}>
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">{state.playing ? <path d="M4 3h4v14H4zm8 0h4v14h-4z" /> : <path d="M6 3l11 7-11 7z" />}</svg>
    </button>
    <div className="audio-waveform">
      <svg viewBox="0 0 400 48" preserveAspectRatio="none" aria-hidden="true">
        {state.peaks.length ? state.peaks.map((peak, index) => <line key={index} x1={index * 4 + 2} x2={index * 4 + 2} y1={24 - Math.max(1, peak * 23)} y2={24 + Math.max(1, peak * 23)} stroke="currentColor" strokeWidth="2" opacity={index / state.peaks.length <= ratio ? 1 : 0.32} />) : <><line x1="0" x2="400" y1="24" y2="24" stroke="currentColor" opacity=".25" strokeWidth="3" /><line x1="0" x2={400 * ratio} y1="24" y2="24" stroke="currentColor" strokeWidth="3" /></>}
        <line x1={400 * ratio} x2={400 * ratio} y1="10" y2="38" stroke="currentColor" strokeWidth="3" />
      </svg>
      <input aria-label={dock ? 'Playback position' : 'Sample position'} type="range" min="0" max={state.duration || 1} step="0.01" value={Math.min(state.currentTime, state.duration || 1)} disabled={!state.available || !state.duration} aria-valuetext={`${time(state.currentTime, state.duration)} of ${time(state.duration)}`} onChange={event => state.onSeek(Number(event.target.value))} />
    </div>
    <span className="audio-time">{time(state.currentTime, state.duration)} / {time(state.duration)}</span>
    {dock && <input className="audio-volume" aria-label="Playback volume" type="range" min="0" max="1" step="0.01" value={state.volume} onChange={event => state.onVolume(Number(event.target.value))} />}
  </div>;
}
