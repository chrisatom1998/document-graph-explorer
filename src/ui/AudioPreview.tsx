import { useEffect, useRef, useState } from 'react';
import type { DocNode } from '../model/types';
import { getOriginal } from '../persistence/originals';
import { saveAudioGraph } from '../audio/saveAudioGraph';
import { useGraphStore } from '../store/graphStore';
import { layoutReheat, layoutSetLinks } from '../layout/layoutBridge';
import { namedRelationship } from '../audio/relationships';
import MusicFeatures from './MusicFeatures';
import { mimeForFilename } from '../util/fileMime';

export default function AudioPreview({ node }: { node: DocNode }) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const phase = useGraphStore((s) => s.phase);
  const [url, setUrl] = useState('');
  const [original, setOriginal] = useState<{ blob: Blob; name: string } | null>(null);
  const [message, setMessage] = useState('Loading audio…');
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const [converting, setConverting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const conversion = useRef<AbortController | null>(null);
  const active = useRef(true);
  const liveUrl = useRef('');
  const player = useRef<HTMLAudioElement>(null);
  const idle = phase === 'ready' && !saving;
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void getOriginal(node.id).then((record) => {
      if (cancelled) return;
      if (!record) { setMessage('Audio is not saved here. Add the original file again to play it.'); return; }
      setOriginal(record);
      liveUrl.current = URL.createObjectURL(record.blob.slice(0, record.blob.size, mimeForFilename(record.name)));
      setUrl(liveUrl.current); setMessage('');
    }).catch(() => { if (active.current) setMessage('Could not load audio. Add the original file again.'); });
    return () => { cancelled = true; active.current = false; conversion.current?.abort(); if (liveUrl.current) URL.revokeObjectURL(liveUrl.current); };
  }, [node.id]);
  const convert = async () => {
    if (!original || converting) return;
    const controller = new AbortController();
    conversion.current = controller;
    setConverting(true); setMessage('Preparing playback on this device…');
    try {
      const { convertAudio } = await import('../audio/convertAudio');
      const blob = await convertAudio(original.blob, original.name, controller.signal);
      if (!active.current) return;
      URL.revokeObjectURL(liveUrl.current);
      liveUrl.current = URL.createObjectURL(blob);
      setUrl(liveUrl.current); setMessage('Ready to play.');
    } catch (error) {
      if (active.current) setMessage(error instanceof Error ? error.message : 'Could not convert this audio.');
    } finally { conversion.current = null; if (active.current) setConverting(false); }
  };
  const persist = async () => {
    setSaving(true);
    try {
      const result = await saveAudioGraph();
      if (active.current) { setMessage(result); setSaveFailed(false); }
    } catch {
      if (active.current) { setMessage('Your relationships are visible but could not be saved. Retry before closing.'); setSaveFailed(true); }
    } finally { if (active.current) setSaving(false); }
  };
  const updateEdges = async (next: typeof edges) => {
    useGraphStore.getState().setEdges(next);
    layoutSetLinks(next.map(({ source, target, weight }) => ({ source, target, weight })));
    layoutReheat(0.4);
    await persist();
  };
  return <div className="side-panel__reader audio-preview">
    {url && <audio ref={player} key={url} controls preload="metadata" src={url} aria-label={`Play ${node.title}`} onError={() => setMessage('This format needs conversion. Choose Prepare playback.')} />}
    {message && <p role="status">{message}</p>}
    {saveFailed && <button type="button" disabled={!idle} onClick={() => void persist()}>Retry saving relationships</button>}
    {original && <details><summary>Playback options</summary><button type="button" disabled={converting} onClick={() => void convert()}>{converting ? 'Preparing…' : 'Prepare playback'}</button></details>}
    <MusicFeatures node={node} onSeek={url ? (seconds) => {
      if (!player.current) return;
      try {
        player.current.currentTime = seconds;
        void player.current.play().catch(() => setMessage('Choose Prepare playback if this format cannot play on your device.'));
      } catch { setMessage('Choose Prepare playback to listen to this section.'); }
    } : undefined} />
    <details className="music-manual-link"><summary>Connect to another track</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const current = useGraphStore.getState();
        const edge = namedRelationship(current.nodes, node.id, target, label);
        void updateEdges([...current.edges.filter((e) => e.id !== edge.id), edge]);
        setLabel('');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect tracks.'); }
    }}>
      <label>Connect to<select aria-label="Track to connect" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a track</option>{nodes.filter((n) => n.fileType === 'audio' && n.id !== node.id).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
      <label>Relationship<input value={label} maxLength={180} placeholder="Similar bassline, shared sample, same mood…" onChange={(e) => setLabel(e.target.value)} /></label>
      <button type="submit" disabled={!idle || !target || !label.trim()}>Connect tracks</button>
    </form>
    {!idle && !saving && <p>Wait for file processing to finish before editing relationships.</p>}
    </details>
    {edges.filter((e) => e.authored && (e.source === node.id || e.target === node.id)).map((edge) => <div key={edge.id}><span>{nodes.find((n) => n.id === (edge.source === node.id ? edge.target : edge.source))?.title}: {edge.evidence[0]?.replace(/^Your relationship: /, '')}</span><button type="button" disabled={!idle} aria-label={`Remove relationship ${edge.evidence[0]}`} onClick={() => void updateEdges(useGraphStore.getState().edges.filter((e) => e.id !== edge.id))}>Remove</button></div>)}
  </div>;
}
