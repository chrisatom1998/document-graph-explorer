import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { usePlayerStore } from '../../store/playerStore';
import { Waveform, formatClock, placeholderPeaks, useClipAudio } from './ClipWave';
import { gradientFor, keyOf, soundTagsOf, tagBasisText, tagText, tempoOf } from './forYouModel';
import type { DocNode } from '../../model/types';

const BARS = placeholderPeaks('resonance-idle', 72).map(() => 0.12);

function Icon({ d, fill = true }: { d: string; fill?: boolean }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

/** The fixed bottom player. It plays the clip chosen in For you (or the graph) from its saved original; with none chosen it says so. */
export default function Transport() {
  const currentId = usePlayerStore(s => s.currentId);
  const playNonce = usePlayerStore(s => s.playNonce);
  const queueLength = usePlayerStore(s => s.queue.length);
  const node = useGraphStore(s => (currentId ? s.nodes.find(n => n.id === currentId) : undefined)) as DocNode | undefined;
  if (!node) return <TransportShell />;
  return <Loaded key={node.id} node={node} playNonce={playNonce} canStep={queueLength > 1} />;
}

function TransportShell() {
  return (
    <footer className="fy-transport" aria-label="Audio player">
      <div className="fy-transport__now">
        <span className="fy-transport__art fy-transport__art--idle" aria-hidden="true" />
        <span className="fy-transport__titles"><strong>Nothing playing</strong><small>Press play on a sound to hear it here.</small></span>
      </div>
      <div className="fy-transport__controls">
        <button type="button" className="fy-tbtn" disabled aria-label="Previous sound"><Icon d="M4 3v10M5 8l6-4.5v9z" /></button>
        <button type="button" className="fy-tbtn fy-tbtn--main" disabled aria-label="Play"><Icon d="M5 3l8 5-8 5z" /></button>
        <button type="button" className="fy-tbtn" disabled aria-label="Next sound"><Icon d="M12 3v10M11 8 5 3.5v9z" /></button>
      </div>
      <div className="fy-transport__wave" aria-hidden="true"><Waveform peaks={BARS} color="#6f6a86" height={36} /></div>
    </footer>
  );
}

function Loaded({ node, playNonce, canStep }: { node: DocNode; playNonce: number; canStep: boolean }) {
  const { url, peaks } = useClipAudio(node);
  const audio = useRef<HTMLAudioElement>(null);
  const wantPlay = useRef(playNonce > 0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(node.audio?.durationSeconds ?? 0);
  const [a, b] = gradientFor(node);
  const bpm = tempoOf(node);
  const key = keyOf(node);
  const tags = useMemo(() => soundTagsOf(node).slice(0, 3), [node]);
  const bars = peaks.length ? peaks : placeholderPeaks(node.id, 72);

  // A play request (card, crate, next/previous) starts the clip once its original has loaded.
  const lastNonce = useRef(0);
  useEffect(() => {
    if (playNonce === lastNonce.current) return;
    lastNonce.current = playNonce;
    wantPlay.current = true;
    const el = audio.current;
    if (el && url) { el.currentTime = 0; void el.play().catch(() => setPlaying(false)); wantPlay.current = false; }
  }, [playNonce, url]);
  useEffect(() => {
    const el = audio.current;
    if (el && url && wantPlay.current) { wantPlay.current = false; void el.play().catch(() => setPlaying(false)); }
  }, [url]);

  const toggle = () => { const el = audio.current; if (!el || !url) return; if (el.paused) void el.play().catch(() => setPlaying(false)); else el.pause(); };
  const seekTo = (seconds: number) => { const el = audio.current; if (el && Number.isFinite(el.duration)) el.currentTime = Math.min(Math.max(seconds, 0), el.duration); };
  const progress = duration > 0 ? Math.min(time / duration, 1) : 0;
  const onSeekKey = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : 0;
    if (!step) return;
    event.preventDefault();
    seekTo(time + step);
  };

  return (
    <footer className="fy-transport" aria-label="Audio player">
      <audio
        ref={audio} src={url || undefined} loop={loop} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }}
      />
      <div className="fy-transport__now">
        <span className="fy-transport__art" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} aria-hidden="true" />
        <span className="fy-transport__titles">
          <strong title={node.title}>{node.title}</strong>
          <small>{url ? (node.path?.split('/').slice(-2, -1)[0] ?? 'Saved on this device') : node.fileType === 'audio' ? 'Original not stored here. Add the file again to play it.' : 'Documents have no audio to play.'}</small>
        </span>
      </div>
      <div className="fy-transport__controls">
        <button type="button" className="fy-tbtn" disabled={!canStep} aria-label="Previous sound" onClick={() => usePlayerStore.getState().step(-1)}><Icon d="M4 3v10M5 8l6-4.5v9z" /></button>
        <button type="button" className="fy-tbtn fy-tbtn--main" disabled={!url} aria-label={playing ? `Pause ${node.title}` : `Play ${node.title}`} onClick={toggle}>
          {playing ? <Icon d="M4 3h3v10H4zM9 3h3v10H9z" /> : <Icon d="M5 3l8 5-8 5z" />}
        </button>
        <button type="button" className="fy-tbtn" disabled={!canStep} aria-label="Next sound" onClick={() => usePlayerStore.getState().step(1)}><Icon d="M12 3v10M11 8 5 3.5v9z" /></button>
        <button type="button" className={`fy-tbtn fy-tbtn--loop${loop ? ' is-on' : ''}`} aria-pressed={loop} aria-label="Loop" onClick={() => setLoop(v => !v)}><Icon fill={false} d="M3 7V6a2 2 0 0 1 2-2h7l-2-2m3 7v1a2 2 0 0 1-2 2H4l2 2" /></button>
      </div>
      <div
        className="fy-transport__wave" role="slider" tabIndex={url ? 0 : -1} aria-label={`Seek in ${node.title}`} aria-disabled={!url}
        aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
        onKeyDown={onSeekKey}
        onClick={event => { const r = event.currentTarget.getBoundingClientRect(); seekTo(((event.clientX - r.left) / r.width) * duration); }}
      >
        <Waveform peaks={bars} color="#c8f55a" progress={progress} height={36} />
      </div>
      <div className="fy-transport__meta">
        <span className="fy-time" aria-hidden="true">{formatClock(time)} / {formatClock(duration)}</span>
        {bpm !== null && <span className="fy-chip fy-chip--dark">{bpm} BPM</span>}
        {key && <span className="fy-chip fy-chip--dark">{key}</span>}
        {tags.map(t => <span key={t.label} className={`fy-tag fy-tag--small fy-tag--${t.basis}`} title={tagBasisText(t.basis)}>{tagText(t)}</span>)}
      </div>
    </footer>
  );
}
