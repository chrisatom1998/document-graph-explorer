import { createHash } from 'node:crypto';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const stableJSON = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const manifestDigest = manifest => hash(stableJSON(manifest));
export const terminal = audio => audio?.stage !== 'preview'
  && ['complete', 'partial', 'failed', 'cancelled'].includes(audio?.recognition?.status);
export const usable = audio => terminal(audio) && audio.recognition.status === 'complete';

export function validateManifest(manifest) {
  const fail = message => { throw new Error(`Invalid benchmark: ${message}`); };
  if (manifest?.version !== 1 || !Array.isArray(manifest.clips) || !manifest.clips.length) fail('expected version 1 and nonempty clips');
  if (!Array.isArray(manifest.labels) || !manifest.labels.length || new Set(manifest.labels).size !== manifest.labels.length
    || manifest.labels.some(l => typeof l !== 'string' || !/^(source|effect|vocal|role|character):.+$/.test(l))) fail('invalid/duplicate labels');
  const ids = new Set(), files = new Set(), digests = new Map(), groups = new Map();
  for (const clip of manifest.clips) {
    if (typeof clip.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(clip.id) || ids.has(clip.id)) fail('invalid/duplicate clip id');
    ids.add(clip.id);
    if (typeof clip.file !== 'string' || !/^c\d{6}\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(clip.file) || files.has(clip.file)) fail(`${clip.id}: file must be a unique opaque basename`);
    files.add(clip.file);
    if (!/^[a-f0-9]{64}$/.test(clip.sha256)) fail(`${clip.id}: missing SHA-256`);
    if (digests.has(clip.sha256)) fail(`${clip.id}: duplicate audio bytes (${digests.get(clip.sha256)})`);
    digests.set(clip.sha256, clip.id);
    if (!['development', 'test'].includes(clip.split)) fail(`${clip.id}: invalid split`);
    if (typeof clip.group !== 'string' || !clip.group.trim()) fail(`${clip.id}: missing artist/pack/family group`);
    if (groups.has(clip.group) && groups.get(clip.group) !== clip.split) fail(`${clip.id}: group crosses development/test`);
    groups.set(clip.group, clip.split);
    if (!['one-shot', 'loop', 'mix'].includes(clip.kind) || !Number.isFinite(clip.seconds) || clip.seconds <= 0) fail(`${clip.id}: invalid kind/duration`);
    if (!['human-reviewed', 'published-annotation'].includes(clip.provenance?.type)
      || typeof clip.provenance.reference !== 'string' || !clip.provenance.reference.trim()) fail(`${clip.id}: missing verified label provenance`);
    if (!clip.truth || typeof clip.truth !== 'object' || Array.isArray(clip.truth)
      || Object.keys(clip.truth).some(k => !manifest.labels.includes(k))
      || manifest.labels.some(k => !Object.hasOwn(clip.truth, k) || ![0, 1, null].includes(clip.truth[k]))) fail(`${clip.id}: every label must be 0, 1, or null (unknown)`);
    if (!Object.values(clip.truth).some(v => v !== null)) fail(`${clip.id}: no observed labels`);
  }
  return manifest;
}

export function assertDisjoint(manifest, excluded) {
  const hashes = new Set(excluded.clips.map(c => c.sha256));
  const groups = new Set(excluded.clips.map(c => c.group));
  for (const clip of manifest.clips.filter(c => c.split === 'test')) {
    if (hashes.has(clip.sha256) || groups.has(clip.group)) throw new Error(`Test contamination: ${clip.id} overlaps excluded training/tuning audio`);
  }
}

export function percentile(values, fraction) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  return xs.length ? xs[Math.max(0, Math.ceil(xs.length * fraction) - 1)] : null;
}

export function scoreClips(manifest, predictions, { split = 'test', minSupport = 20 } = {}) {
  validateManifest(manifest);
  const byId = new Map();
  for (const p of predictions) {
    if (byId.has(p.id)) throw new Error(`Duplicate prediction: ${p.id}`);
    if (!Array.isArray(p.labels) || p.labels.some(l => typeof l !== 'string')) throw new Error(`Invalid predictions: ${p.id}`);
    byId.set(p.id, p);
  }
  const clips = manifest.clips.filter(c => c.split === split);
  if (!clips.length) throw new Error(`No ${split} clips`);
  const status = { complete: 0, partial: 0, failed: 0, cancelled: 0, missing: 0 };
  for (const c of clips) {
    const s = byId.get(c.id)?.status;
    status[Object.hasOwn(status, s) ? s : 'missing']++;
  }
  function table(items) {
    return Object.fromEntries(manifest.labels.map(label => {
      let tp = 0, fp = 0, fn = 0, tn = 0, unknown = 0, unscored = 0;
      const falsePositives = [], falseNegatives = [];
      for (const c of items) {
        const truth = c.truth[label], p = byId.get(c.id);
        if (truth === null) { unknown++; continue; }
        // Incomplete runs cannot contribute favorable true negatives or precision.
        // Positive labels still count as misses in the end-to-end recall denominator.
        if (p?.status !== 'complete') {
          unscored++;
          if (truth === 1) { fn++; falseNegatives.push(c.id); }
          continue;
        }
        const hit = p.labels.includes(label);
        if (truth === 1 && hit) tp++;
        else if (truth === 0 && hit) { fp++; falsePositives.push(c.id); }
        else if (truth === 1) { fn++; falseNegatives.push(c.id); }
        else tn++;
      }
      const precision = tp + fp ? tp / (tp + fp) : null;
      const recall = tp + fn ? tp / (tp + fn) : null;
      const supported = tp + fn >= minSupport && fp + tn >= minSupport;
      return [label, { tp, fp, fn, tn, unknown, unscored, precision, recall,
        f1: precision === null || recall === null ? null : precision + recall ? 2 * precision * recall / (precision + recall) : 0,
        positiveSupport: tp + fn, evaluatedNegativeSupport: fp + tn,
        meets70: supported && unscored === 0 && precision >= .7 && recall >= .7,
        supported, falsePositives, falseNegatives }];
    }));
  }
  const buckets = {
    'under-2s': c => c.seconds < 2, '2-to-10s': c => c.seconds >= 2 && c.seconds <= 10,
    'over-10s': c => c.seconds > 10,
    ...Object.fromEntries(['one-shot', 'loop', 'mix'].map(k => [k, c => c.kind === k])),
  };
  return { version: 1, manifestSha256: manifestDigest(manifest), split, clips: clips.length, status,
    complete: status.complete === clips.length, minSupport, labels: table(clips),
    slices: Object.fromEntries(Object.entries(buckets).map(([k, predicate]) => {
      const selected = clips.filter(predicate); return [k, { clips: selected.length, labels: table(selected) }];
    })) };
}

export function inspectGraph(graph, files) {
  const wanted = new Set(files);
  const nodes = (graph?.nodes ?? []).filter(n => wanted.has(n.path ?? n.title));
  const names = new Set(nodes.map(n => n.path ?? n.title));
  return { expected: files.length, found: names.size,
    complete: nodes.filter(n => usable(n.audio)).length,
    terminal: names.size === files.length && nodes.length === files.length && nodes.every(n => terminal(n.audio)),
    statuses: nodes.map(n => ({ file: n.path ?? n.title, status: n.audio?.recognition?.status ?? 'missing' })),
    nodes: graph?.nodes?.length ?? 0, edges: graph?.edges?.length ?? 0 };
}
