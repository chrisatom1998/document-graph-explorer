import { useEffect, useId, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import type { DocNode } from '../../model/types';
import { getOriginal } from '../../persistence/originals';
import { useGraphStore } from '../../store/graphStore';
import { useWaveform } from '../../ui/AudioControls';
import { placeholderPeaks } from '../../ui/resonance/ClipWave';
import { clipColor, clipFacts, clipTags, clock, type TagGroup } from './library';
import { playClip, seekTo, usePlayerStore } from './player';

/** Decoded 100-bucket peaks plus the file size they came from, so a same-id re-import with a new file decodes again. */
const decodedPeaks = new Map<string, { size: number; peaks: number[] }>();

/** Drop cached waveforms. A content-hash id already names the bytes; this covers a cleared library. */
export function clearDecodedPeaks(): void { decodedPeaks.clear(); }

useGraphStore.subscribe((state, prev) => {
  if (prev && prev.nodes.length > 0 && state.nodes.length === 0) clearDecodedPeaks();
});

function shapePeaks(source: number[], buckets: number): number[] {
  const max = Math.max(...source, 0.0001);
  const step = source.length / buckets;
  return Array.from({ length: buckets }, (_, i) => {
    let peak = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) peak = Math.max(peak, source[j] ?? 0);
    return Math.max(0.06, peak / max);
  });
}

/**
 * Peaks for a stored clip. List tiles pass `enabled: false` and keep placeholder
 * bars. Hero, now-playing and the scrubber decode, once per clip id and file size.
 */
export function useClipPeaks(node: DocNode | undefined, buckets = 64, enabled = true): { peaks: number[]; real: boolean } {
  const id = node?.fileType === 'audio' ? node.id : undefined;
  const [owned, setOwned] = useState<{ id: string; blob: Blob } | null>(null);
  const [decoded, setDecoded] = useState<number[]>([]);
  useEffect(() => {
    if (!enabled || !id) { setOwned(null); return; }
    let cancelled = false;
    setOwned(null);
    setDecoded([]);
    void getOriginal(id).then(record => {
      if (cancelled || !record) return;
      const cached = decodedPeaks.get(id);
      if (cached && cached.size === record.blob.size) { setDecoded(cached.peaks); return; }
      setOwned({ id, blob: record.blob });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, enabled]);
  const fresh = useWaveform(owned?.blob ?? null);
  useEffect(() => {
    if (!owned || owned.id !== id || !fresh.length) return;
    decodedPeaks.set(owned.id, { size: owned.blob.size, peaks: fresh });
    setDecoded(fresh);
  }, [fresh, owned, id]);
  return useMemo(() => {
    if (!decoded.length) return { peaks: placeholderPeaks(id ?? 'none', buckets), real: false };
    return { peaks: shapePeaks(decoded, buckets), real: true };
  }, [decoded, id, buckets]);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}
/** Mix a colour toward black (negative) or white (positive). */
export function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  return rgbToHex(hexToRgb(hex).map(v => v + (target - v) * Math.abs(amount)));
}
/** Rotate hue by swapping toward the next channel; enough to give each cover a second tone. */
export function partner(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([b * 0.9 + 40, r * 0.85, g * 0.95 + 30]);
}

export function WaveBars({ peaks, color, progress = -1, className }: { peaks: number[]; color: string; progress?: number; className?: string }) {
  const width = 200;
  const height = 40;
  const step = width / peaks.length;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((p, i) => {
        const h = Math.max(2, p * height);
        const played = progress >= 0 && (i + 0.5) / peaks.length <= progress;
        return <rect key={i} x={i * step + step * 0.18} y={(height - h) / 2} width={step * 0.64} height={h} rx={step * 0.32} fill={color} opacity={progress < 0 || played ? 1 : 0.38} />;
      })}
    </svg>
  );
}

/** Album-art style cover generated from the clip's cluster colour, shape and real waveform. */
export function CoverArt({ node, className = '', radius = 8, waveform = false }: { node: DocNode; className?: string; radius?: number; waveform?: boolean }) {
  const id = useId().replace(/:/g, '');
  const base = clipColor(node);
  const second = partner(base);
  const facts = clipFacts(node);
  const { peaks } = useClipPeaks(node, 28, waveform);
  const seed = [...node.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const cx = 30 + (seed % 40);
  const cy = 26 + ((seed >> 4) % 30);
  return (
    <svg className={`mx-cover ${className}`} viewBox="0 0 100 100" role="img" aria-label={`${node.title} cover`} style={{ borderRadius: radius }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(base, 0.08)} />
          <stop offset="1" stopColor={shade(second, -0.35)} />
        </linearGradient>
        <radialGradient id={`r${id}`} cx={cx / 100} cy={cy / 100} r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#g${id})`} />
      {facts.shape === 'Loop' && [14, 24, 34, 44].map(r => <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeOpacity={0.16} strokeWidth="1.4" />)}
      {facts.shape === 'One-shot' && <circle cx={cx} cy={cy} r="22" fill="#fff" fillOpacity="0.16" />}
      {node.fileType !== 'audio' && [0, 1, 2, 3, 4].map(i => <rect key={i} x="14" y={18 + i * 9} width={60 - (i % 3) * 12} height="3" rx="1.5" fill="#fff" fillOpacity="0.28" />)}
      <rect width="100" height="100" fill={`url(#r${id})`} />
      {node.fileType === 'audio' && (
        <g transform="translate(10 64)">
          {peaks.map((p, i) => <rect key={i} x={i * 2.9} y={14 - p * 13} width="1.8" height={Math.max(1.5, p * 26)} rx="0.9" fill="#fff" fillOpacity="0.86" />)}
        </g>
      )}
      <text x="10" y="96" fill="#fff" fillOpacity="0.8" fontSize="7" fontWeight="700" letterSpacing="0.8">{facts.kind.toUpperCase()}</text>
    </svg>
  );
}

export function Chips({ node, className = '' }: { node: DocNode; className?: string }) {
  const f = clipFacts(node);
  return (
    <span className={`mx-chips ${className}`}>
      {f.key && <span className="mx-chip mx-chip--key" title="Musical key">{f.key}</span>}
      {f.bpm !== null && <span className="mx-chip mx-chip--bpm" title="Tempo">{f.bpm} BPM</span>}
      {f.shape && <span className="mx-chip">{f.shape}</span>}
      {node.fileType === 'audio' && f.seconds !== null && <span className="mx-chip mx-chip--time">{clock(f.seconds)}</span>}
      {node.fileType !== 'audio' && <span className="mx-chip">{node.fileType.toUpperCase()}</span>}
    </span>
  );
}

const PlayGlyph = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>;
const PauseGlyph = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" /></svg>;

export function PlayButton({ node, className = '', onPlay }: { node: DocNode; className?: string; onPlay?: () => void }) {
  const active = usePlayerStore(s => s.currentId === node.id && s.playing);
  if (node.fileType !== 'audio') return null;
  return (
    <button
      type="button"
      className={`mx-play ${active ? 'is-playing' : ''} ${className}`}
      aria-label={active ? `Pause ${node.title}` : `Play ${node.title}`}
      onClick={event => { event.stopPropagation(); onPlay?.(); playClip(node.id); }}
    >
      {active ? <PauseGlyph /> : <PlayGlyph />}
    </button>
  );
}

export function TransportGlyph({ kind }: { kind: 'play' | 'pause' | 'prev' | 'next' }) {
  if (kind === 'play') return <PlayGlyph />;
  if (kind === 'pause') return <PauseGlyph />;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={kind === 'prev' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M5 6.2v11.6a.8.8 0 0 0 1.24.67L15 12.67a.8.8 0 0 0 0-1.34L6.24 5.53A.8.8 0 0 0 5 6.2z" /><rect x="16.5" y="5.5" width="2.5" height="13" rx="1" />
    </svg>
  );
}

/** Seekable waveform for the clip that is playing (or the given clip before it plays). */
export function Scrubber({ node, color, className = '' }: { node: DocNode; color: string; className?: string }) {
  const { peaks } = useClipPeaks(node, 90);
  const current = usePlayerStore(s => s.currentId === node.id);
  const progress = usePlayerStore(s => (s.currentId === node.id ? s.progress : 0));
  const seek = (event: MouseEvent<HTMLButtonElement>) => {
    if (!current) { playClip(node.id); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width);
  };
  return (
    <button type="button" className={`mx-scrub ${className}`} onClick={seek} aria-label={`Seek in ${node.title}`} style={{ '--mx-scrub': color } as CSSProperties}>
      <WaveBars peaks={peaks} color={color} progress={progress} />
    </button>
  );
}

const GROUP_LABEL: Record<TagGroup, string> = {
  Key: 'Key', Tempo: 'Tempo', Shape: 'Type', Part: 'Part', Genre: 'Genre', Sound: 'Sounds', Character: 'Character', Type: 'File',
};

/** All of the selected clip's tags as full-size chips, each labelled with its category. */
export function TagChips({ node, className = '', heading = 'Tags' }: { node: DocNode; className?: string; heading?: string }) {
  const tags = clipTags(node);
  return (
    <section className={`mx-tags ${className}`} aria-label={`${heading} for ${node.title}`}>
      <h3 className="mx-tags__head">{heading}</h3>
      {tags.length ? (
        <ul className="mx-tags__list">
          {tags.map(tag => (
            <li key={`${tag.group}-${tag.label}`} className={`mx-tag mx-tag--${tag.group.toLowerCase()}`}>
              <span className="mx-tag__group">{GROUP_LABEL[tag.group]}</span>
              <span className="mx-tag__label">{tag.label}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mx-tags__none">No tags yet. Analysis adds them as it finishes.</p>}
    </section>
  );
}
