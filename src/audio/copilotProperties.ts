import { DJ_LABELS, type ConfirmedDjTags, type DjGroup } from './djTags';
import type { CopilotSample } from './copilotEvidence';

export interface CopilotProperties { tags: ConfirmedDjTags; model: string }
export interface CopilotSuggestion { ref: string; tags: ConfirmedDjTags }
const groups = Object.keys(DJ_LABELS) as DjGroup[];

/** Reject malformed properties rather than quietly assigning them to another sound. */
export function parseSuggestedTags(value: unknown): ConfirmedDjTags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid suggested properties.');
  const raw = value as Record<string, unknown>;
  const tags = { source: [], production: [], character: [] } as ConfirmedDjTags;
  for (const group of groups) {
    const labels = raw[group];
    if (!Array.isArray(labels) || labels.length > 12 || labels.some(label => typeof label !== 'string' || !DJ_LABELS[group].includes(label))) throw Error('Invalid suggested properties.');
    tags[group] = [...new Set(labels as string[])];
  }
  return tags;
}
export function sanitizeCopilotProperties(value: unknown): CopilotProperties | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Record<string, unknown>;
  if (typeof raw.model !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(raw.model)) return;
  try { return { tags: parseSuggestedTags(raw.tags), model: raw.model }; } catch { return; }
}
export function parseCopilotSuggestions(value: unknown, samples: CopilotSample[]): CopilotSuggestion[] {
  if (!Array.isArray(value) || value.length > samples.length) throw Error('Invalid suggested samples.');
  const seen = new Set<string>();
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') throw Error('Invalid suggested sample.');
    const sample = samples.find(s => s.ref === raw.ref);
    if (!sample || seen.has(raw.ref)) throw Error('Invalid suggested sample reference.');
    seen.add(raw.ref);
    const tags = parseSuggestedTags(raw.tags);
    // Confirmed labels, including an explicitly empty set, always win. Source
    // suggestions must not conflict with a separately confirmed instrument list.
    if (sample.confirmedTags !== null) return [];
    if (sample.confirmedInstruments !== null) tags.source = [];
    return Object.values(tags).some(labels => labels.length) ? [{ ref: sample.ref, tags }] : [];
  });
}
export const copilotReviewSchema = {
  type: 'object', additionalProperties: false, required: ['answer', 'suggestions'],
  properties: {
    answer: { type: 'string' },
    suggestions: { type: 'array', maxItems: 5, items: {
      type: 'object', additionalProperties: false, required: ['ref', 'tags'],
      properties: {
        ref: { type: 'string', enum: ['Sample 1', 'Sample 2', 'Sample 3', 'Sample 4', 'Sample 5'] },
        tags: { type: 'object', additionalProperties: false, required: groups,
          properties: Object.fromEntries(groups.map(group => [group, { type: 'array', maxItems: 12, items: { type: 'string', enum: DJ_LABELS[group] } }])) },
      },
    } },
  },
};
