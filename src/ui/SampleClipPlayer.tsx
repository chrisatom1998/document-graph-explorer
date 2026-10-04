import { useEffect, useState } from 'react';
import type { DocNode } from '../model/types';
import { getOriginal } from '../persistence/originals';
import { mimeForFilename } from '../util/fileMime';

export default function SampleClipPlayer({ node }: { node: DocNode }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; let objectUrl = '';
    void getOriginal(node.id).then(record => {
      if (cancelled) return;
      if (!record) { setError('Add the original file again to play it.'); return; }
      objectUrl = URL.createObjectURL(record.blob.slice(0, record.blob.size, mimeForFilename(record.name)));
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setError('Could not load the saved audio.'); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [node.id]);
  return <>{url && <audio controls autoPlay src={url} aria-label={`Play ${node.title}`} onError={() => setError('This format needs conversion. Use Open in graph, then Prepare playback.')} />}{error && <p role="status">{error}</p>}</>;
}
