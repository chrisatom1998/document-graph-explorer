import { useEffect, useRef, useState } from 'react';
import { copilotWave, TRANSCRIPTION_RATE } from '../audio/copilotWave';

/** Microphone access starts only after the user presses Record. Audio is bounded to 20s. */
export default function VoiceQuery({ onTranscript, disabled = false }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [status, setStatus] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef<{ recorder?: MediaRecorder; stream?: MediaStream; controller: AbortController; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const localApi = import.meta.env.DEV && import.meta.env.MODE !== 'airgap';
  useEffect(() => () => {
    const session = active.current; active.current = null;
    session?.controller.abort(); clearTimeout(session?.timer);
    session?.stream?.getTracks().forEach(track => track.stop());
    if (session?.recorder?.state === 'recording') session.recorder.stop();
  }, []);
  const start = async () => {
    if (busy || disabled || !localApi) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setStatus('Voice recording is unavailable in this browser. Type your request instead.'); return; }
    const session = { controller: new AbortController() } as NonNullable<typeof active.current>;
    active.current = session; setBusy(true); setStatus('Allow microphone access to speak your request.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session.controller.signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      const recorder = new MediaRecorder(stream); session.recorder = recorder;
      const chunks: Blob[] = []; let size = 0;
      recorder.ondataavailable = event => { if (event.data.size) { size += event.data.size; chunks.push(event.data); if (size > 5_000_000 && recorder.state === 'recording') recorder.stop(); } };
      recorder.onstop = () => { void (async () => {
        clearTimeout(session.timer); stream.getTracks().forEach(track => track.stop());
        if (session.controller.signal.aborted) return;
        setRecording(false); setStatus('Transcribing your request…');
        try {
          if (size > 5_000_000) throw Error('The recording is too large. Try a shorter request.');
          const context = new AudioContext();
          let wav: ArrayBuffer;
          try {
            const decoded = await context.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
            const frames = Math.min(Math.ceil(decoded.duration * TRANSCRIPTION_RATE), 20 * TRANSCRIPTION_RATE);
            if (!frames) throw Error('No speech was recorded. Try again.');
            const offline = new OfflineAudioContext(1, frames, TRANSCRIPTION_RATE);
            const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
            wav = copilotWave((await offline.startRendering()).getChannelData(0));
          } finally { await context.close(); }
          session.controller.signal.throwIfAborted();
          const response = await fetch('/api/dj-copilot/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-DJ-Assistant': '1' }, body: wav, signal: session.controller.signal });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || 'Voice transcription failed.');
          if (typeof data.text !== 'string' || !data.text.trim()) throw Error('No words were recognized. Try again or type your request.');
          if (!session.controller.signal.aborted) { onTranscript(data.text.trim()); setStatus('Transcript ready. Check it before sending.'); }
        } catch (error) { if (!session.controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Voice transcription failed.'); }
        finally { if (active.current === session) { active.current = null; setBusy(false); } }
      })(); };
      recorder.onerror = () => { session.controller.abort(); active.current = null; stream.getTracks().forEach(track => track.stop()); clearTimeout(session.timer); setStatus('Recording failed. Type your request or try again.'); setRecording(false); setBusy(false); };
      recorder.start(250); setRecording(true); setStatus('Recording up to 20 seconds. Stop when finished.');
      session.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 20_000);
    } catch (error) {
      session.stream?.getTracks().forEach(track => track.stop());
      if (!session.controller.signal.aborted) { setStatus(error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError' ? 'Microphone access was denied. Type your request or allow the microphone in browser settings.' : 'Could not start recording. Type your request instead.'); setBusy(false); }
    }
  };
  return <div className="voice-query">
    <button type="button" disabled={disabled || !localApi || (busy && !recording)} aria-label={recording ? 'Stop voice recording' : 'Speak your request'} onClick={() => { if (recording) active.current?.recorder?.stop(); else void start(); }}>{recording ? 'Stop recording' : busy ? 'Transcribing…' : 'Speak your request'}</button>
    <small>Voice sends up to 20 seconds to OpenAI for transcription.</small>
    {status && <p role="status">{status}</p>}
  </div>;
}
