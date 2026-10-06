import type { TrackStructure as Structure, SectionLabel } from '../audio/structure';
import { clockTime as time } from './clockTime';
import './TrackStructure.css';

const NAMES: Record<SectionLabel, string> = { intro: 'Intro', buildup: 'Build', drop: 'Drop', breakdown: 'Breakdown', outro: 'Outro' };

/** Mix points on the track card: a strip of the track's sections and a button per point that starts a section. */
export default function TrackStructure({ structure, duration, onSeek }: { structure: Structure; duration: number; onSeek?: (seconds: number) => void }) {
  if (!structure.sections.length || !(duration > 0)) return null;
  let drop = 0;
  const points = structure.sections.map(s => ({ ...s, name: s.label === 'drop' ? `Drop ${++drop}` : NAMES[s.label] }));
  return <section className="track-structure" aria-label="Mix points">
    <h4 className="track-structure__title">Mix points</h4>
    <div className="track-structure__strip" aria-hidden="true">
      {points.map(p => <span key={p.start} className={`track-structure__part track-structure__part--${p.label}`}
        style={{ left: `${p.start / duration * 100}%`, width: `${(p.end - p.start) / duration * 100}%` }} title={`${p.name} ${time(p.start)}–${time(p.end)}`} />)}
    </div>
    <ul className="track-structure__points">
      {points.map(p => <li key={p.start}>
        <button type="button" className={`track-structure__point track-structure__point--${p.label}`} disabled={!onSeek} onClick={() => onSeek?.(p.start)}
          aria-label={`Play from ${p.name.toLowerCase()} at ${time(p.start)}`}>
          <span>{p.name}</span><time>{time(p.start)}</time>
        </button>
      </li>)}
    </ul>
    <p className="track-structure__note">Found from loudness and bass in the audio; boundaries can be a bar or two off.</p>
  </section>;
}
