import { useEffect, useRef, useState } from 'react';
import { getOriginal } from '../../persistence/originals';
import { mimeForFilename } from '../../util/fileMime';
import { useGraphStore } from '../../store/graphStore';
import { resetPlayer, usePlayerStore } from './player';

/** How long the playing clip may be missing from the graph before playback is dropped. */
export const CLIP_GONE_GRACE_MS = 1000;

/** The one audio element behind every play button and now-playing bar in the music designs. */
export default function NowPlayingAudio() {
  const currentId = usePlayerStore(s => s.currentId);
  const command = usePlayerStore(s => s.command);
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState('');
  const wantsPlay = useRef(false);
  const inGraph = useGraphStore(s => !currentId || s.nodeIndex[currentId] !== undefined);

  // Switching or clearing the workspace removes the clip: stop instead of playing on with no usable pause control.
  // A re-import empties the graph for a moment and brings the same clip back, so wait before forgetting it.
  useEffect(() => {
    if (inGraph) return;
    const timer = window.setTimeout(resetPlayer, CLIP_GONE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [inGraph]);

  // One sound at a time: the inspector's own players pause this one when they start.
  useEffect(() => {
    const onPlay = (event: Event) => {
      if (!(event.target instanceof HTMLMediaElement) || event.target === audio.current) return;
      wantsPlay.current = false;
      audio.current?.pause();
    };
    document.addEventListener('play', onPlay, true);
    return () => document.removeEventListener('play', onPlay, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setUrl('');
    if (!currentId) return;
    void getOriginal(currentId).then(record => {
      if (cancelled || !record) return;
      objectUrl = URL.createObjectURL(record.blob.slice(0, record.blob.size, mimeForFilename(record.name)));
      setUrl(objectUrl);
    }).catch(() => { /* Not stored on this device: the bar shows the clip without playback. */ });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [currentId]);

  useEffect(() => {
    const el = audio.current;
    if (!command) return;
    if (command.kind === 'play') {
      wantsPlay.current = true;
      if (el && url) void el.play().catch(() => usePlayerStore.setState({ playing: false }));
    } else if (command.kind === 'pause') {
      wantsPlay.current = false;
      el?.pause();
    } else if (el && Number.isFinite(el.duration) && command.at !== undefined) {
      el.currentTime = command.at * el.duration;
    }
  }, [command, url]);

  if (!url) return null;
  return (
    <audio
      ref={audio}
      src={url}
      preload="auto"
      onCanPlay={event => { if (wantsPlay.current && event.currentTarget.paused) void event.currentTarget.play().catch(() => {}); }}
      onPlay={event => {
        const self = event.currentTarget;
        document.querySelectorAll('audio').forEach(other => { if (other !== self) other.pause(); });
        usePlayerStore.setState({ playing: true });
      }}
      onPause={() => usePlayerStore.setState({ playing: false })}
      onEnded={() => { wantsPlay.current = false; usePlayerStore.setState({ playing: false, progress: 0 }); }}
      onTimeUpdate={event => { const el = event.currentTarget; if (el.duration) usePlayerStore.setState({ progress: el.currentTime / el.duration }); }}
    />
  );
}
