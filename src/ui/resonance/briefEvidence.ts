import type { Edge } from '../../model/types';

/**
 * A one-line, plain-language reading of an edge's evidence for the inspector:
 * what is shared, and where that came from. The full evidence sentences stay on
 * the edge (and in the row's hover text); this only shortens what is shown.
 */
export function briefEvidence(edge: Edge): string {
  const text = edge.evidence.join(' ');
  return [what(edge, text), basis(edge, text)].filter(Boolean).join(' · ');
}

const stripGroups = (list: string) => list.replace(/\s*\([^)]*\)/g, '').replaceAll('_', ' ').trim();

function what(edge: Edge, text: string): string {
  switch (edge.kind) {
    case 'tempo':
      return /Half\/double-time/.test(text) ? 'half / double time' : '';
    case 'key': {
      const relation = /:\s*([^:.]+)\.(?:\s|$)/.exec(text.replace(/^Harmonic key relation:[^:]*:/, 'x:'))?.[1]?.trim();
      return relation && relation !== 'same estimated key' ? relation.replace('estimated ', '') : '';
    }
    case 'instrument':
      return stripGroups(/Shared instruments?(?: hints)?: ([^.]+)\./.exec(text)?.[1] ?? '');
    case 'sound':
      return stripGroups(/Shared sound properties: (.+?)\.\s(?:Confirmed|Not confirmed)/.exec(text)?.[1] ?? '');
    case 'similar': {
      const both = /Both also have: (.+?)(?:, (?:confirmed by you|some confirmed|detected by)[^.]*)?\./.exec(text)?.[1];
      return both ? `both have ${stripGroups(both)}` : '';
    }
    case 'title': {
      const phrase = /Shared title phrase: “([^”]+)”/.exec(text)?.[1];
      return phrase ? `“${phrase}”` : '';
    }
    default: {
      const first = edge.evidence[0]?.split(/(?<=\.)\s/)[0] ?? '';
      return first.length > 80 ? `${first.slice(0, 77)}…` : first;
    }
  }
}

function basis(edge: Edge, text: string): string {
  if (edge.kind === 'similar') return /confirmed by you on both/.test(text) ? 'sound fingerprint, tags confirmed by you' : 'sound fingerprint';
  if (edge.kind === 'title') return 'from file names';
  if (/Confirmed by you on both tracks/.test(text)) return 'confirmed by you';
  if (/Confirmed by you on one track|some confirmed by you/.test(text)) return 'partly confirmed by you';
  const sources = /Sources: ([^.]+)\./.exec(text)?.[1];
  if (sources) {
    const named = /file name|folder name/.test(sources);
    const audio = /audio estimate/.test(sources);
    const mine = /confirmed by you/.test(sources);
    if (named && !audio && !mine) return 'from file names';
    if (named) return mine ? 'from names and your tags' : 'from names and audio';
  }
  if (edge.kind === 'tempo' || edge.kind === 'key') return 'measured from audio';
  if (/maybe-level/.test(text)) return 'weak model guess';
  if (/Not confirmed|model estimate|guess/.test(text)) return 'model guess';
  return '';
}
