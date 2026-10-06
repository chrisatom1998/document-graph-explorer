import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocNode } from '../../model/types';
import { getOriginal } from '../../persistence/originals';
import { mimeForFilename } from '../../util/fileMime';
import { useWaveform } from '../AudioControls';
import { hexFor } from '../../scene/palette';

/** Object URL + decoded peaks for a clip's saved original; empty when the file is not stored here. */
export function useClipAudio(node: DocNode) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setBlob(null);
    setUrl('');
    if (node.fileType !== 'audio') return;
    void getOriginal(node.id).then(record => {
      if (cancelled || !record) return;
      setBlob(record.blob);
      objectUrl = URL.createObjectURL(record.blob.slice(0, record.blob.size, mimeForFilename(record.name)));
      setUrl(objectUrl);
    }).catch(() => { /* Playback stays unavailable; the row still shows the clip. */ });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [node.id, node.fileType]);
  const peaks = useWaveform(blob);
  return { url, peaks };
}

/** Stable stand-in bars for clips whose audio has not decoded (or is not stored). */
export function placeholderPeaks(seed: string, buckets = 100): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const noise = ((h >>> 0) % 1000) / 1000;
    const envelope = Math.sin((i / buckets) * Math.PI) * 0.7 + 0.3;
    out.push(0.15 + noise * envelope * 0.85);
  }
  return out;
}

export function Waveform({ peaks, color, progress = 0, height = 44, className }: {
  peaks: number[]; color: string; progress?: number; height?: number; className?: string;
}) {
  const width = 300;
  const bars = peaks.length || 1;
  const step = width / bars;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((p, i) => {
        const h = Math.max(1.5, p * height * 0.92);
        const played = (i + 0.5) / bars <= progress;
        return <rect key={i} x={i * step + step * 0.2} y={(height - h) / 2} width={step * 0.6} height={h} rx={step * 0.3} fill={color} opacity={played ? 1 : 0.55} />;
      })}
    </svg>
  );
}

/** Circular node thumbnail: a waveform for audio, a glyph of the file type otherwise. */
export function ClipThumb({ node, peaks, size = 60, active = false }: { node: DocNode; peaks?: number[]; size?: number; active?: boolean }) {
  const color = hexFor(Math.max(0, node.cluster));
  const bars = useMemo(() => (peaks && peaks.length ? peaks : placeholderPeaks(node.id, 40)), [peaks, node.id]);
  return (
    <span className={`rs-thumb${active ? ' is-active' : ''}`} style={{ width: size, height: size, '--rs-thumb-color': color } as React.CSSProperties} aria-hidden="true">
      {node.fileType === 'audio'
        ? <Waveform peaks={bars} color={color} height={30} className="rs-thumb__wave" />
        : <span className="rs-thumb__type">{node.fileType.toUpperCase().slice(0, 4)}</span>}
    </span>
  );
}

/** Play button + waveform scrubber for one clip; no-ops (disabled) when the original is not stored. */
export function ClipPlayer({ node, url, peaks, color }: { node: DocNode; url: string; peaks: number[]; color: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => { setPlaying(false); setProgress(0); }, [url]);
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
  const seek = (event: React.MouseEvent<HTMLButtonElement>) => {
    const el = audio.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    el.currentTime = ((event.clientX - rect.left) / rect.width) * el.duration;
  };
  const bars = peaks.length ? peaks : placeholderPeaks(node.id);
  return (
    <div className="rs-player">
      <button type="button" className="rs-player__play" onClick={toggle} disabled={!url} aria-label={playing ? `Pause ${node.title}` : `Play ${node.title}`} title={url ? undefined : 'Add the original file again to play it.'}>
        {playing
          ? <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="3" height="8" /><rect x="7" y="2" width="3" height="8" /></svg>
          : <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" /></svg>}
      </button>
      <button type="button" className="rs-player__wave" onClick={seek} aria-label={`Seek in ${node.title}`} disabled={!url}>
        <Waveform peaks={bars} color={color} progress={progress} />
      </button>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0); }}
          onTimeUpdate={event => { const el = event.currentTarget; if (el.duration) setProgress(el.currentTime / el.duration); }}
        />
      )}
    </div>
  );
}

export function formatClock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "Solar Drift" from "solar-drift_vocal-loop.wav"-style names; the raw file name stays as the second line. */
export function displayName(node: DocNode): { name: string; file: string } {
  const file = node.path?.split('/').pop() ?? node.title;
  const stem = file.replace(/\.[a-z0-9]{1,5}$/i, '');
  const words = stem.split(/[\s_\-.]+/).filter(Boolean);
  const name = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || node.title;
  return { name, file };
}
