import { useEffect, useState } from 'react';
import { clearLibrary, libraryStats, type LibraryStats } from '../persistence/library';
import { useGraphStore } from '../store/graphStore';

const count = (n: number, noun: string, plural = `${noun}s`) => `${n.toLocaleString()} ${n === 1 ? noun : plural}`;

/**
 * Settings → Data → Library: what this browser remembers about files already
 * read, so re-reading a folder skips unchanged files, plus ways to refresh it.
 */
export default function LibrarySettings() {
  const [stats, setStats] = useState<LibraryStats | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outdated, setOutdated] = useState<string[]>([]);
  const audioIds = useGraphStore((s) =>
    s.nodes.filter((n) => n.kind === 'document' && n.fileType === 'audio').map((n) => n.id).join('\n'),
  );
  const phase = useGraphStore((s) => s.phase);
  const tracks = audioIds ? audioIds.split('\n') : [];

  useEffect(() => {
    let live = true;
    void libraryStats().then((value) => {
      if (live) setStats(value);
    });
    return () => {
      live = false;
    };
  }, [note]);

  // Adding files never re-analyzes the rest of the library, so tracks from an older detector release wait here.
  useEffect(() => {
    let live = true;
    if (!audioIds || (phase !== 'ready' && phase !== 'idle')) {
      setOutdated([]);
      return;
    }
    void import('../pipeline/coordinatorLazy')
      .then((m) => {
        if (live) setOutdated(m.outdatedAudioIds());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [audioIds, phase, note]);

  const forget = () => {
    setBusy(true);
    setNote(null);
    void clearLibrary()
      .then((ok) =>
        setNote(
          ok
            ? 'Saved library forgotten. Files you add next are read and analyzed again; tracks already open keep their results.'
            : 'Could not clear the saved library (storage unavailable).',
        ),
      )
      .finally(() => setBusy(false));
  };

  const reanalyze = () => {
    setBusy(true);
    setNote(null);
    void import('../pipeline/coordinatorLazy')
      .then((m) => m.analyzeAudioCorpus(tracks))
      .then(
        () => setNote(`Re-analyzed ${count(tracks.length, 'track')}. New results replace the saved ones.`),
        (error: unknown) =>
          setNote(error instanceof Error && error.name === 'AbortError' ? 'Re-analysis cancelled.' : 'Re-analysis failed. Try again.'),
      )
      .finally(() => setBusy(false));
  };

  const update = () => {
    setBusy(true);
    setNote(null);
    const updating = outdated.length;
    void import('../pipeline/coordinatorLazy')
      .then((m) => m.analyzeAudioCorpus(outdated))
      .then(
        () => setNote(`Updated ${count(updating, 'track')} with the current detectors.`),
        (error: unknown) =>
          setNote(error instanceof Error && error.name === 'AbortError' ? 'Update cancelled.' : 'Update failed. Try again.'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="library-settings" aria-label="Saved library">
      <p className="settings-help">
        {stats === undefined
          ? 'Checking the saved library…'
          : stats === null
            ? 'This browser is not saving the library (storage unavailable).'
            : `Saved library: ${count(stats.files, 'file')} remembered, ${count(stats.analyses, 'track analysis', 'track analyses')} kept. Re-reading a folder skips files whose name, size and date have not changed.`}
      </p>
      {outdated.length > 0 && (
        <p className="settings-help">
          {`${count(outdated.length, 'track')} ${outdated.length === 1 ? 'was' : 'were'} analyzed by an older version of the detectors. Adding files leaves them as they are; update them when you have time.`}
        </p>
      )}
      <div className="settings-confirm">
        {outdated.length > 0 && (
          <button
            type="button"
            className="settings-btn"
            disabled={busy || (phase !== 'ready' && phase !== 'idle')}
            onClick={update}
            title="Re-analyze only the tracks whose saved results came from an older version of the detectors."
          >
            {`Update ${count(outdated.length, 'older track')}`}
          </button>
        )}
        <button
          type="button"
          className="settings-btn"
          disabled={busy || tracks.length === 0 || (phase !== 'ready' && phase !== 'idle')}
          onClick={reanalyze}
          title="Run the current detectors on every track in this workspace again, ignoring saved results."
        >
          Re-analyze all tracks
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={busy}
          onClick={forget}
          title="Forget which files were already read and every saved track analysis. Open workspaces are not changed."
        >
          Forget saved library
        </button>
      </div>
      {note && <p className="settings-note" role="status">{note}</p>}
    </div>
  );
}
