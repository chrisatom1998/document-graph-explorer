import { resolvedNonSourceLabels, reviewedSoundProfile, semanticCategoryReviewAllows, canonicalSoundCategoryText } from '../audio/soundReviewPolicy';
import { sampleLabels } from '../audio/sampleSearch';
import type { DocNode, Edge } from '../model/types';
import type { ChatSource } from '../store/chatStore';
import { musicNameHints } from '../audio/nameHints';
import { keyName } from '../audio/musicTypes';
import { musicPairEdges } from '../audio/musicLinks';
import { INSTRUMENT_PARENTS } from '../audio/instrumentLabels';
import { confirmedInstrumentList, sourceReviewAllows } from '../audio/instrumentEvidence';
import type { CorpusChunk } from './allDocumentContext';

/** Always derive evidence from the live graph so corrections supersede old text. */
export function musicEvidence(node: DocNode, compact = false): string {
  const hints = musicNameHints(node);
  const a = node.audio;
  const tempo = hints.tempo ? `${hints.tempo.value} BPM (from ${hints.tempo.source})` : a?.tempo ? `${a.tempo.bpm.toFixed(1)} BPM (estimated${compact ? '' : `; confidence ${a.tempo.confidence.toFixed(2)}`})` : 'unknown tempo';
  const key = hints.key ? `${hints.key.displayName} (from ${hints.key.source})` : a?.key ? `${keyName(a.key)} (estimated${compact ? '' : `; strength ${a.key.strength.toFixed(2)}`})` : 'unknown key';
  const nonSource = a ? resolvedNonSourceLabels(a) : [];
  const confirmedTags = a?.confirmedDjTags === undefined ? undefined : [...(confirmedInstrumentList(a)??[]),...nonSource.filter(t=>t.source==='confirmed').map(t=>t.label)];
  const sourceHints=hints.instruments?.value.filter(label=>!a||sourceReviewAllows(a,label));
  const confirmedInstruments = a ? confirmedInstrumentList(a) : undefined;
  const instruments = confirmedTags !== undefined ? `${[...new Set([...confirmedTags, ...(confirmedInstruments ?? [])])].join(', ') || 'none'} (confirmed by you)` : confirmedInstruments !== undefined
    ? `${confirmedInstruments.join(', ') || 'none'} (confirmed by you)`
    : sourceHints?.length ? `${sourceHints.join(', ')} (from ${hints.instruments!.source})`
    : a?.soundProfile?.source && sourceReviewAllows(a,a.soundProfile.source.label) ? `${a.soundProfile.source.label} (estimated)`
    : a?.instrumentPrediction && sourceReviewAllows(a,a.instrumentPrediction.label) ? `${a.instrumentPrediction.label} (estimated)`
    : a?.instruments.filter(i => i.status === 'likely' && sourceReviewAllows(a,i.label)).map(i => `${i.label} (estimated)`).join(', ') || 'unknown';
  const reviewedNonSource = confirmedTags === undefined ? nonSource.filter(t=>t.source==='confirmed').map(t=>t.label) : [];
  const reviewed = reviewedNonSource.length ? ` Confirmed effect/character: ${reviewedNonSource.join(', ')} (confirmed by you).` : '';
  if (compact) return `${tempo} · ${key} · ${instruments === 'unknown' ? 'unknown instrument' : instruments}${reviewed}`;
  const voice = confirmedTags === undefined && confirmedInstruments === undefined && a?.soundProfile?.voice && sourceReviewAllows(a,'voice') ? ` Voice: ${a.soundProfile.voice.style || 'voice'} (estimated).` : '';
  const characters = nonSource.filter(t=>t.group==='character'&&t.source==='estimated').map(t=>t.label);
  const character = characters.length ? ` Character: ${characters.join(', ')} (estimated).` : '';
  const profile = a ? reviewedSoundProfile(a) : undefined;
  const roles = confirmedTags === undefined && confirmedInstruments === undefined && profile?.roles.length ? ` Suggested role: ${profile.roles.join(', ')} (estimated).` : '';
  return `Tempo: ${tempo}. Key: ${key}. Sound: ${instruments}.${a ? ` Duration: ${a.durationSeconds.toFixed(1)} seconds.` : ' Audio has not been analyzed.'}${voice}${character}${roles}${reviewed}${a?.stage === 'preview' ? ' Preliminary analysis; verification is unfinished.' : ''}`;
}

const safeTitle = (title: string) => title.replace(/[\\`*_{}[\]<>#|]/g, '\\$&').replace(/\s+/g, ' ');
const normal = (value: string) => value.toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b');

export interface MusicCopilotResult { text: string; sources: ChatSource[]; chunks: CorpusChunk[] }

export function musicCopilotAnswer(question: string, nodes: DocNode[], edges: Edge[], selectedId: string | null): MusicCopilotResult {
  const audio = nodes.filter(n => n.kind === 'document' && n.fileType === 'audio');
  const q = normal(question);
  const selected = audio.find(n => n.id === selectedId);
  const named = audio.filter(n => q.includes(normal(n.title)) && n.title.length > 2);
  const anchor = named[0] ?? selected;
  let results: DocNode[] = [];
  const reasons = new Map<string, string>();
  let lead = '';
  const literalFilename = /\b(?:file\s*names?|filenames?|named|titled)\b/.test(q);
  const comparison = /\b(compare|difference|versus|vs\.?)\b/.test(q);
  const matching = /\b(match|matches|pair|pairs|compatible|similar|goes with|work with|go with|mix with)\b/.test(q);
  const uncertain = /\b(uncertain|unknown|unanalyzed|unanalysed|unverified|review|incomplete|missing)\b/.test(q);
  const overview = /\b(overview|summari[sz]e|summary|library|collection)\b/.test(q) && !comparison && !matching && !uncertain;

  if (!audio.length) lead = 'Add audio files to this collection to use the music copilot.';
  else if (!literalFilename && comparison) {
    results = named.length > 1 ? named.slice(0, 2) : anchor ? [anchor] : [];
    if (results.length < 2) lead = 'Name two samples to compare, using their titles from All files.';
    else {
      const links = musicPairEdges(results[0], results[1]);
      lead = links.length ? `These samples share ${[...new Set(links.map(e => e.kind))].join(', ')} features. Audition both to judge how they work together.` : 'No supported tempo, key, or instrument match was found between these samples.';
    }
  } else if (!literalFilename && matching) {
    if (!anchor) lead = 'Select a sample in the graph, then ask “Find matches for this sample”.';
    else {
      const ranked = audio.filter(n => n.id !== anchor.id).map(node => {
        const links = musicPairEdges(anchor, node);
        const authored = edges.filter(e => e.authored && ((e.source === anchor.id && e.target === node.id) || (e.target === anchor.id && e.source === node.id)));
        const all = [...links, ...authored];
        return { node, links: all, score: all.reduce((sum, e) => sum + e.weight, 0) };
      }).filter(r => r.links.length > 0).sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
      results = ranked.slice(0, 5).map(r => r.node);
      ranked.slice(0, 5).forEach(r => reasons.set(r.node.id, r.links.map(e => e.evidence[0]).join(' ')));
      lead = results.length ? `Matches for **${safeTitle(anchor.title)}**, ranked by supported musical connections. Audition them together; matching features do not guarantee a good mix.` : `No supported matches for **${safeTitle(anchor.title)}** yet. Analyze more samples or review missing tempo, key, and instrument labels.`;
    }
  } else if (!literalFilename && uncertain) {
    results = audio.filter(n => !n.audio || n.audio.stage === 'preview' || (!n.audio.tempo && !musicNameHints(n).tempo) || (!n.audio.key && !musicNameHints(n).key) || /Sound: unknown/.test(musicEvidence(n))).slice(0, 5);
    lead = results.length ? 'These samples have missing or preliminary features. Open one to review its analysis.' : 'No missing or preliminary features were found. Estimated labels still need your judgment.';
  } else if (!literalFilename && overview) {
    const analyzed = audio.filter(n => n.audio && n.audio.stage !== 'preview').length;
    const confirmed = audio.filter(n => n.audio?.confirmedInstruments !== undefined || n.audio?.confirmedDjTags !== undefined).length;
    results = audio.slice(0, 5);
    lead = `Your collection contains **${audio.length} samples**: ${analyzed} with completed analysis and ${confirmed} with instrument labels confirmed by you. ${audio.length > 5 ? 'Here are the first five.' : ''}`;
  } else {
    const range = q.match(/\b(\d{2,3})(?:\s*(?:-|–|to|and)\s*)(\d{2,3})\s*bpm\b/);
    const bpm = q.match(/\b(\d{2,3}(?:\.\d+)?)\s*bpm\b/);
    const key = q.match(/\b([a-g](?:#|b)?)\s+(major|minor)\b/);
    const stop = new Set(['find','me','some','show','samples','sample','tracks','track','sounds','sound','with','at','in','the','a','an','and','or','please','for','this','selected','tell','about','what','is','are','my','bpm','between','to','around','near','major','minor']);
    const terms = canonicalSoundCategoryText(q).replace(/\b\d+(?:\.\d+)?\b/g, '').replace(key?.[0] ?? /$^/, '').split(/[^a-z#]+/).filter(t => t.length > 1 && !stop.has(t));
    const min = range ? Math.min(+range[1], +range[2]) : bpm ? +bpm[1] - 3 : null;
    const max = range ? Math.max(+range[1], +range[2]) : bpm ? +bpm[1] + 3 : null;
    const aliases: Record<string, string> = { synth: 'synthesizer', synths: 'synthesizer', vocals: 'voice', vocal: 'voice', chops: 'chop', drums: 'drum' };
    const requestedInstruments = musicNameHints({ title: question }).instruments?.value ?? [];
    const notes: Record<string, number> = { c:0,'c#':1,db:1,d:2,'d#':3,eb:3,e:4,fb:4,'e#':5,f:5,'f#':6,gb:6,g:7,'g#':8,ab:8,a:9,'a#':10,bb:10,b:11,cb:11 };
    const literalWords=(text:string)=>normal(text).replace(/[^\p{L}\p{N}#]+/gu,' ').trim();
    const quoted=q.match(/["“]([^"”]+)["”]/)?.[1];
    const literalTerms=quoted?[literalWords(quoted)]:literalWords(q).split(' ').filter(t=>!stop.has(t)&&!['file','files','name','names','filename','filenames','named','titled','containing','contains'].includes(t));
    results = audio.filter(n => {
      if(literalFilename) {
        const filename=literalWords(`${n.title} ${n.path?.split(/[\\/]/).at(-1)??''}`);
        return literalTerms.length>0&&literalTerms.every(term=>filename.includes(term));
      }
      if(n.audio&&!semanticCategoryReviewAllows(n.audio,q))return false;
      const hints = musicNameHints(n);
      const tempo = hints.tempo?.value ?? n.audio?.tempo?.bpm;
      const pitch = hints.key?.value ?? n.audio?.key;
      if (min !== null && max !== null && (tempo === undefined || tempo < min || tempo > max)) return false;
      if (key && (!pitch || pitch.tonic !== notes[key[1]] || pitch.mode !== key[2])) return false;
      if(n.audio && requestedInstruments.some(label=>!sourceReviewAllows(n.audio!,label)))return false;
      const humanInstruments = n.audio ? confirmedInstrumentList(n.audio) : undefined;
      if ((n.audio?.confirmedDjTags !== undefined || humanInstruments !== undefined) && requestedInstruments.length) {
        const labels = new Set(sampleLabels(n).filter(l => l.source === 'confirmed').flatMap(l => [l.label, ...(INSTRUMENT_PARENTS[l.label] ?? [])]));
        if (!requestedInstruments.every(label => labels.has(label))) return false;
      }
      // Titles are useful for discovery; sound matches use the current label, never stale guesses.
      const haystack = canonicalSoundCategoryText(`${n.title} ${musicEvidence(n)} ${sampleLabels(n).map(t=>t.label).join(' ')}`);
      return terms.every(term => haystack.includes(term) || haystack.includes(aliases[term] ?? term));
    });
    if (!literalFilename && anchor && /\b(this|selected)\b/.test(q) && min === null && !key && (!anchor.audio||semanticCategoryReviewAllows(anchor.audio,q))) results = [anchor];
    const count = results.length;
    results = results.slice(0, 5);
    lead = literalFilename ? `${count} filename match${count===1?'':'es'} found. Filename text does not establish sound categories.` : count ? `${count} sample${count === 1 ? '' : 's'} found${count > 5 ? '; showing the first five' : ''}.${bpm && !range ? ' Tempo search uses ±3 BPM.' : ''}` : 'No samples match that request in the current collection. Try “Find 140 BPM synths”, “Show uncertain samples”, or select a sample and ask for matches.';
  }
  const evidenceNodes = [...new Map([...(!literalFilename && matching && anchor ? [anchor] : []), ...results].map(n => [n.id, n])).values()];
  const sources = evidenceNodes.map(node => ({ docId: node.id, score: 1, snippet: musicEvidence(node) }));
  const text = [lead, ...results.map((node, index) => `${index + 1}. **${safeTitle(node.title)}** — ${musicEvidence(node, true)}`)].join('\n\n');
  const chunks = evidenceNodes.map(node => ({ docId: node.id, docTitle: node.title, score: 1, text: `${musicEvidence(node)}${reasons.has(node.id) ? ` Matching evidence: ${reasons.get(node.id)}` : ''}` }));
  return { text, sources, chunks };
}

export const MUSIC_COPILOT_INSTRUCTIONS = 'You are the music copilot for this sample library. Help find, compare, and audition samples using ONLY the provided musical evidence. Do not claim to have listened to the audio. Distinguish confirmed labels, filename/folder tags, and audio estimates. Unknown tempo or key stays unknown. Musical similarity is not proof of shared samples, influence, or a guaranteed good mix. Do not invent playback, editing, or graph actions.';
