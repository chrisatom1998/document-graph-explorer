import { describe, expect, it } from 'vitest';

import {
  DJ_CATALOG,
  DJ_HIDDEN_LABELS,
  DJ_LABELS,
  DJ_TYPE_SOURCE,
  MERGED_DJ_LABELS,
  soundLabelText,
  type DjGroup,
} from './djTags';

const catalogIds = new Set(DJ_CATALOG.map(({ group, label }) => `${group}:${label}`));

describe('djTags catalog integrity', () => {
  it('has unique ids and non-empty labels and display names', () => {
    const offenders: string[] = [];
    const seenIds = new Set<string>();

    DJ_CATALOG.forEach(({ group, label }, index) => {
      const id = `${group}:${label}`;
      if (seenIds.has(id)) offenders.push(`duplicate catalog id: ${id}`);
      seenIds.add(id);
      if (label.trim() === '') offenders.push(`empty label at catalog index ${index}: ${id}`);
      if (soundLabelText(label).trim() === '') offenders.push(`empty display name: ${id}`);
    });

    for (const group of Object.keys(DJ_LABELS) as DjGroup[]) {
      const seenLabels = new Set<string>();
      for (const label of DJ_LABELS[group]) {
        const id = `${group}:${label}`;
        if (seenLabels.has(label)) offenders.push(`duplicate DJ_LABELS entry: ${id}`);
        seenLabels.add(label);
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  it('keeps hidden and merged source tags disjoint and catalog-backed', () => {
    const offenders: string[] = [];

    for (const id of DJ_HIDDEN_LABELS) {
      if (Object.hasOwn(MERGED_DJ_LABELS, id)) offenders.push(`hidden and merged: ${id}`);
      if (!catalogIds.has(id)) offenders.push(`hidden tag missing from catalog: ${id}`);
    }
    for (const id of Object.keys(MERGED_DJ_LABELS)) {
      if (!catalogIds.has(id)) offenders.push(`merged tag missing from catalog: ${id}`);
    }

    expect(offenders.sort()).toEqual([]);
  });

  it('points every merged tag at an existing catalog tag', () => {
    const offenders = Object.entries(MERGED_DJ_LABELS)
      .map(([id, target]) => ({ id, targetId: `${target.group}:${target.label}` }))
      .filter(({ targetId }) => !catalogIds.has(targetId))
      .map(({ id, targetId }) => `${id} -> ${targetId}`)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('keeps umbrella tags and DJ_TYPE_SOURCE consistent with production children', () => {
    const offenders: string[] = [];
    const productionEntries = DJ_CATALOG.filter(entry => entry.group === 'production');
    const catalogSources = new Map<string, string>();

    for (const entry of productionEntries) {
      if (entry.source === null) continue;
      catalogSources.set(entry.label, entry.source);
      if (DJ_TYPE_SOURCE[entry.label] !== entry.source) {
        offenders.push(
          `DJ_TYPE_SOURCE mismatch for production:${entry.label}: expected source:${entry.source}, got ${DJ_TYPE_SOURCE[entry.label] === undefined ? 'missing' : `source:${DJ_TYPE_SOURCE[entry.label]}`}`,
        );
      }
    }

    for (const [child, umbrella] of Object.entries(DJ_TYPE_SOURCE)) {
      const catalogSource = catalogSources.get(child);
      if (catalogSource !== umbrella) {
        offenders.push(
          `catalog source mismatch for production:${child}: DJ_TYPE_SOURCE has source:${umbrella}, catalog has ${catalogSource === undefined ? 'no non-null source' : `source:${catalogSource}`}`,
        );
      }
    }

    const umbrellas = new Set([...catalogSources.values(), ...Object.values(DJ_TYPE_SOURCE)]);
    const childrenByUmbrella = new Map<string, Set<string>>();
    for (const [child, umbrella] of catalogSources) {
      const children = childrenByUmbrella.get(umbrella) ?? new Set<string>();
      children.add(child);
      childrenByUmbrella.set(umbrella, children);
    }
    for (const [child, umbrella] of Object.entries(DJ_TYPE_SOURCE)) {
      const children = childrenByUmbrella.get(umbrella) ?? new Set<string>();
      children.add(child);
      childrenByUmbrella.set(umbrella, children);
    }

    if (!umbrellas.has('drums')) offenders.push('source:drums is not an umbrella');
    if ((childrenByUmbrella.get('drums')?.size ?? 0) === 0) {
      offenders.push('source:drums has no production children');
    }

    for (const umbrella of umbrellas) {
      if (!catalogIds.has(`source:${umbrella}`)) {
        offenders.push(`umbrella missing from source catalog: source:${umbrella}`);
      }
      const children = childrenByUmbrella.get(umbrella) ?? new Set<string>();
      if (children.size === 0) offenders.push(`umbrella has no children: source:${umbrella}`);
      for (const child of children) {
        if (!catalogIds.has(`production:${child}`)) {
          offenders.push(`umbrella child missing from production catalog: source:${umbrella} -> production:${child}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });
});
