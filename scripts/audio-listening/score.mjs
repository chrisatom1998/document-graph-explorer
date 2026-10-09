// Fixed before evaluation. Unknown annotations are never negative examples.
export const CLASSES = {
  drums: ['drums', 'drum kit', 'drum machine'], voice: ['voice'], synthesizer: ['synthesizer'],
  piano: ['piano', 'electric piano'], guitar: ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'],
  bass: ['bass', 'bass guitar', 'double bass'], cymbals: ['cymbals'], organ: ['organ'],
  violin: ['violin', 'violin / fiddle'], trumpet: ['trumpet'], saxophone: ['saxophone'],
};
export function classesFor(labels) {
  return Object.entries(CLASSES).filter(([, names]) => names.some(n => labels.includes(n))).map(([cls]) => cls);
}
export function combined(native, audio) {
  return { native, audio, union: [...new Set([...native, ...audio])],
    agreement: native.filter(c => audio.includes(c)), fallback: native.length ? native : audio };
}
export function score(items, records) {
  const modes = ['native', 'audio', 'union', 'agreement', 'fallback'];
  const byId = new Map(records.map(r => [r.id, r]));
  const counts = () => ({ tp: 0, fp: 0, fn: 0, tn: 0 });
  const metrics = c => ({ ...c, precision: c.tp + c.fp ? c.tp / (c.tp + c.fp) : null,
    recall: c.tp + c.fn ? c.tp / (c.tp + c.fn) : null,
    f1: 2 * c.tp + c.fp + c.fn ? 2 * c.tp / (2 * c.tp + c.fp + c.fn) : null });
  return Object.fromEntries(modes.map(mode => {
    const table = Object.fromEntries(Object.keys(CLASSES).map(c => [c, counts()]));
    let evaluated = 0;
    for (const item of items) {
      const record = byId.get(item.id);
      if (!record || record.error) continue; // failed calls are reported separately, never scored as silence
      evaluated++;
      const predictions = combined(record.native, record.audio)[mode];
      for (const r of item.reviews ?? []) {
        if (r.dimension !== 'source' || !table[r.label] || !['present', 'absent'].includes(r.state)) continue;
        const positive = r.state === 'present', hit = predictions.includes(r.label);
        table[r.label][positive ? hit ? 'tp' : 'fn' : hit ? 'fp' : 'tn']++;
      }
    }
    const total = counts();
    for (const c of Object.values(table)) for (const key of Object.keys(total)) total[key] += c[key];
    return [mode, { evaluated, micro: metrics(total), classes: Object.fromEntries(Object.entries(table).map(([c, v]) => [c, metrics(v)])) }];
  }));
}
