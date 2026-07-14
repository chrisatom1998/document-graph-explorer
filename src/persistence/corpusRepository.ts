import type { DocNode, GraphExport } from '../model/types';
import { useCorpusStore, type CorpusSummary } from '../store/corpusStore';
import { getSetting, lookupGraphCache, setSetting } from './cache';
import { getDb, type CorpusRecord, type WatchedFolderRecord } from './db';

const LAST_CORPUS_ID_KEY = 'lastCorpusId';
const LAST_CORPUS_HASH_KEY = 'lastCorpusHash';
const MAX_CORPUS_NAME_CHARS = 80;

function cleanName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_CORPUS_NAME_CHARS);
  return cleaned || 'Untitled corpus';
}

function inferName(nodes: DocNode[]): string {
  const docs = nodes.filter((node) => node.kind === 'document');
  const paths = docs.map((node) => node.path?.replace(/\\/g, '/') ?? '');
  const roots = new Set(
    paths
      .map((path) => path.split('/')[0])
      .filter((root): root is string => Boolean(root)),
  );
  if (roots.size === 1 && paths.some((path) => path.includes('/'))) {
    return cleanName([...roots][0]);
  }
  if (docs.length === 1) return cleanName(docs[0].title);
  return 'My corpus';
}

function summary(record: CorpusRecord): CorpusSummary {
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    documentCount: record.docHashes.length,
    watching: Boolean(record.watch && !record.watch.paused),
  };
}

async function allRecords(): Promise<CorpusRecord[]> {
  const db = await getDb();
  return (await db.getAll('corpora')).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function publish(
  activeId?: string | null,
  changed?: CorpusRecord,
  removedId?: string,
): Promise<void> {
  const state = useCorpusStore.getState();
  let summaries = state.initialized
    ? state.corpora
    : (await allRecords()).map(summary);
  if (removedId) summaries = summaries.filter((item) => item.id !== removedId);
  if (changed) {
    const next = summary(changed);
    summaries = [...summaries.filter((item) => item.id !== changed.id), next];
  }
  summaries = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt);
  const selected =
    activeId === undefined
      ? (state.activeCorpusId ?? await getSetting<string>(LAST_CORPUS_ID_KEY))
      : activeId ?? undefined;
  state.setLocalState(
    summaries,
    selected && summaries.some((item) => item.id === selected) ? selected : null,
  );
}

async function mutateCorpus(
  id: string,
  mutate: (record: CorpusRecord) => void,
): Promise<CorpusRecord> {
  const db = await getDb();
  const tx = db.transaction('corpora', 'readwrite');
  const store = tx.objectStore('corpora');
  const record = await store.get(id);
  if (!record) {
    await tx.done;
    throw new Error('That corpus is no longer available on this device.');
  }
  mutate(record);
  await store.put(record);
  await tx.done;
  return record;
}

function emptyRecord(name: string): CorpusRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: cleanName(name),
    createdAt: now,
    updatedAt: now,
    corpusHash: null,
    docHashes: [],
    exportData: null,
    positions: {},
  };
}

/** Initialize the stable corpus registry, lazily migrating the legacy last graph. */
export async function initializeCorpusRepository(): Promise<string> {
  let records = await allRecords();
  let activeId = await getSetting<string>(LAST_CORPUS_ID_KEY);
  const legacyHash = await getSetting<string>(LAST_CORPUS_HASH_KEY);

  if (records.length === 0) {
    const legacy = legacyHash ? await lookupGraphCache(legacyHash) : undefined;
    const record = emptyRecord(legacy ? inferName(legacy.exportData.nodes) : 'My corpus');
    if (legacy && legacyHash) {
      record.corpusHash = legacyHash;
      record.docHashes = legacy.exportData.nodes
        .filter((node) => node.kind === 'document')
        .map((node) => node.id);
      record.exportData = legacy.exportData;
      record.positions = legacy.positions;
    }
    const db = await getDb();
    await db.put('corpora', record);
    records = [record];
    activeId = record.id;
  } else if (!activeId || !records.some((record) => record.id === activeId)) {
    activeId = records[0].id;
  }

  // Chat transcripts used the mutable content hash before stable corpus ids.
  // Retry this lazy copy on every initialization until it succeeds so an
  // interrupted v4 -> v5 migration never strands the old transcript.
  if (legacyHash && activeId && legacyHash !== activeId) {
    const db = await getDb();
    const [legacyChat, migratedChat] = await Promise.all([
      db.get('chats', legacyHash),
      db.get('chats', activeId),
    ]);
    if (legacyChat) {
      if (!migratedChat) {
        await db.put('chats', { ...legacyChat, corpusHash: activeId });
      }
      await db.delete('chats', legacyHash);
    }
  }

  await setSetting(LAST_CORPUS_ID_KEY, activeId);
  useCorpusStore.getState().setLocalState(records.map(summary), activeId);
  return activeId;
}

export async function getCorpusRecord(id: string): Promise<CorpusRecord | undefined> {
  return (await getDb()).get('corpora', id);
}

export async function getActiveCorpusRecord(): Promise<CorpusRecord | undefined> {
  const id = useCorpusStore.getState().activeCorpusId ?? await getSetting<string>(LAST_CORPUS_ID_KEY);
  return id ? getCorpusRecord(id) : undefined;
}

export async function activateCorpus(id: string): Promise<void> {
  const record = await getCorpusRecord(id);
  if (!record) throw new Error('That corpus is no longer available on this device.');
  await setSetting(LAST_CORPUS_ID_KEY, id);
  await publish(id, record);
}

export async function createCorpus(name: string): Promise<CorpusRecord> {
  const record = emptyRecord(name);
  await (await getDb()).put('corpora', record);
  await activateCorpus(record.id);
  return record;
}

export async function renameCorpus(id: string, name: string): Promise<void> {
  const record = await mutateCorpus(id, (current) => {
    current.name = cleanName(name);
    current.updatedAt = Date.now();
  });
  await publish(id === useCorpusStore.getState().activeCorpusId ? id : undefined, record);
}

export async function deleteCorpusRecord(id: string): Promise<CorpusRecord | undefined> {
  const db = await getDb();
  const tx = db.transaction('corpora', 'readwrite');
  const store = tx.objectStore('corpora');
  const record = await store.get(id);
  if (!record) {
    await tx.done;
    return undefined;
  }
  await store.delete(id);
  await tx.done;
  await publish(undefined, undefined, id);
  return record;
}

export async function saveActiveCorpusSnapshot(
  corpusHash: string,
  exportData: GraphExport,
  positions: Record<string, [number, number, number]>,
): Promise<CorpusRecord> {
  let activeId = useCorpusStore.getState().activeCorpusId;
  const db = await getDb();
  const tx = db.transaction('corpora', 'readwrite');
  const store = tx.objectStore('corpora');
  let record = activeId ? await store.get(activeId) : undefined;
  if (!record) {
    record = emptyRecord(inferName(exportData.nodes));
    activeId = record.id;
  }
  record.corpusHash = corpusHash;
  record.exportData = exportData;
  record.positions = positions;
  record.docHashes = exportData.nodes
    .filter((node) => node.kind === 'document')
    .map((node) => node.id);
  record.updatedAt = Date.now();
  await store.put(record);
  await tx.done;
  await setSetting(LAST_CORPUS_ID_KEY, activeId);
  await publish(activeId, record);
  return record;
}

export async function saveActiveCorpusPositions(
  corpusHash: string,
  exportData: GraphExport,
  positions: Record<string, [number, number, number]>,
): Promise<void> {
  const activeId = useCorpusStore.getState().activeCorpusId;
  if (!activeId) {
    await saveActiveCorpusSnapshot(corpusHash, exportData, positions);
    return;
  }
  const db = await getDb();
  const tx = db.transaction('corpora', 'readwrite');
  const store = tx.objectStore('corpora');
  const active = await store.get(activeId);
  if (!active || active.corpusHash !== corpusHash) {
    await tx.done;
    await saveActiveCorpusSnapshot(corpusHash, exportData, positions);
    return;
  }
  active.exportData = exportData;
  active.positions = positions;
  active.docHashes = exportData.nodes
    .filter((node) => node.kind === 'document')
    .map((node) => node.id);
  await store.put(active);
  await tx.done;
}

export async function markActiveCorpusEmpty(): Promise<void> {
  const activeId = useCorpusStore.getState().activeCorpusId;
  if (!activeId) return;
  const active = await mutateCorpus(activeId, (current) => {
    current.corpusHash = null;
    current.docHashes = [];
    current.exportData = null;
    current.positions = {};
    current.updatedAt = Date.now();
  });
  await setSetting(LAST_CORPUS_HASH_KEY, '');
  await publish(active.id, active);
}

export async function updateCorpusWatch(
  id: string,
  watch: WatchedFolderRecord | undefined,
): Promise<void> {
  const record = await mutateCorpus(id, (current) => {
    current.watch = watch;
    current.updatedAt = Date.now();
  });
  await publish(undefined, record);
}

/** Candidates not referenced by any saved corpus or named snapshot may be purged safely. */
export async function unreferencedDocumentIds(candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const wanted = new Set(candidates);
  const db = await getDb();
  const [corpora, snapshots] = await Promise.all([
    db.getAll('corpora'),
    db.getAll('snapshots'),
  ]);
  for (const record of corpora) {
    for (const id of record.docHashes) wanted.delete(id);
  }
  for (const record of snapshots) {
    for (const id of record.docHashes) wanted.delete(id);
  }
  return [...wanted];
}

export async function listCorpusRecords(): Promise<CorpusRecord[]> {
  return allRecords();
}
