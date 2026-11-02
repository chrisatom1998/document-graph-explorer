import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Explicit taxonomy alias, not a prediction-dependent truth correction.
export const canonicalResearchLabel = label => label === 'source:marimba' ? 'source:marimba / xylophone' : label;
export function loadManifest(file) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m.version !== 'dge-research-v1' || !Array.isArray(m.clips) || !m.clips.length) throw new Error('Invalid research manifest');
  const ids = new Set(), splits = new Map();
  for (const c of m.clips) {
    if (!c.id || ids.has(c.id) || !c.group || !['development', 'test'].includes(c.split)
      || !(c.seconds > 0) || !c.rights?.evaluationAllowed || !c.rights.basis || !c.provenance) throw new Error(`Invalid clip: ${c.id}`);
    ids.add(c.id);
    if (splits.has(c.group) && splits.get(c.group) !== c.split) throw new Error(`Group leakage: ${c.group}`);
    splits.set(c.group, c.split);
    c.absolutePath = resolve(dirname(file), c.path);
    if (digest(readFileSync(c.absolutePath)) !== c.sha256) throw new Error(`Audio checksum mismatch: ${c.id}`);
    for (const v of Object.values(c.truth?.tags ?? {})) if (![0, 1, null].includes(v)) throw new Error(`Invalid label: ${c.id}`);
    if (c.truth?.tags) c.truth.tags = Object.fromEntries(Object.entries(c.truth.tags).map(([k,v]) => [canonicalResearchLabel(k),v]));
  }
  return m;
}

// A successful prefix is not a successful experiment.
export function isCompleteRun(report, expectedRows) {
  return !report.aborted && report.rows.length === expectedRows
    && report.rows.every(row => row.status === 'complete');
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length
    || [...a, ...b].some(x => !Number.isFinite(x))) throw new Error('Invalid embedding');
  const denominator = Math.hypot(...a) * Math.hypot(...b);
  if (!denominator) throw new Error('Zero embedding');
  return a.reduce((s, x, i) => s + x * b[i], 0) / denominator;
}

// Unknown labels never become negatives; incomplete analysis earns no true negatives.
export function labelMetrics(clips, rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  if (byId.size !== rows.length) throw new Error('Duplicate predictions');
  const labels = [...new Set(clips.flatMap(c => Object.keys(c.truth?.tags ?? {})))].sort();
  return Object.fromEntries(labels.map(label => {
    let tp = 0, fp = 0, fn = 0, tn = 0, unknown = 0, incomplete = 0;
    for (const c of clips) {
      const truth = c.truth?.tags?.[label], row = byId.get(c.id);
      if (truth == null) { unknown++; continue; }
      if (row?.status !== 'complete') { incomplete++; if (truth === 1) fn++; continue; }
      const present = (row.labels ?? []).includes(label);
      if (truth === 1) { if (present) tp++; else fn++; }
      else if (present) fp++; else tn++;
    }
    return [label, { tp, fp, fn, tn, unknown, incomplete,
      precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }];
  }));
}

export function bindingMetrics(rows) {
  const usable = rows.filter(r => r.status === 'complete' && r.binding);
  for (const r of usable) for (const field of ['positive', 'negative']) {
    if (!Number.isFinite(r.binding[field])) throw new Error(`Invalid binding score: ${r.id}`);
  }
  const strict = usable.filter(r => r.binding.positive > r.binding.negative).length;
  const ties = usable.filter(r => r.binding.positive === r.binding.negative).length;
  return { attempted: rows.length, scored: usable.length, strictCorrect: strict, ties,
    accuracy: usable.length ? strict / usable.length : null,
    endToEndAccuracy: rows.length ? strict / rows.length : null,
    note: 'Ties count as incorrect; silence is a separate control, not a correct caption label.' };
}

// Per-label retrieval excludes every crop/transform from the query's original group.
export function retrievalMetrics(clips, rows, k = 5) {
  const byId = new Map(rows.filter(r => r.status === 'complete' && r.embedding).map(r => [r.id, r]));
  const results = [];
  for (const q of clips) {
    const row = byId.get(q.id);
    if (!row) continue;
    for (const [label, value] of Object.entries(q.truth?.tags ?? {})) {
      if (value !== 1) continue;
      const gallery = clips.filter(c => c.group !== q.group && c.truth?.tags?.[label] != null && byId.has(c.id))
        .map(c => ({ id: c.id, relevant: c.truth.tags[label] === 1, score: cosine(row.queryEmbedding ?? row.embedding, byId.get(c.id).embedding) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      if (!gallery.some(c => c.relevant) || !gallery.some(c => !c.relevant)) continue;
      const top = gallery.slice(0, k);
      results.push({ id: q.id, label, gallery: gallery.length, returned: top.length,
        precision: top.filter(c => c.relevant).length / top.length,
        top1: gallery[0].relevant, reciprocalRank: 1 / (gallery.findIndex(c => c.relevant) + 1), top });
    }
  }
  const average = field => results.length ? results.reduce((s, r) => s + Number(r[field]), 0) / results.length : null;
  return { k, queries: results.length, meanPrecision: average('precision'), top1: average('top1'),
    meanReciprocalRank: average('reciprocalRank'), note: 'Queries require at least one known positive and negative in a different source group.', results };
}
