import { fingerprint, type PcmAudio } from './fingerprint';
import { matchSource, type Candidate } from './matching';
export type MatchingWorkerRequest = { kind: 'fingerprint'; audio: PcmAudio } | { kind: 'match'; audio: PcmAudio; candidates: Candidate[]; fileSha256: string };
self.onmessage = (event: MessageEvent<MatchingWorkerRequest>) => {
  try {
    const input = event.data;
    const fp = fingerprint(input.audio);
    self.postMessage({ ok: true, value: input.kind === 'fingerprint' ? fp : matchSource(fp, input.candidates, {}, { fileSha256: input.fileSha256 }) });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Source comparison failed.' }); }
};
