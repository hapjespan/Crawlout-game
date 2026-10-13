// Desync dump (contract 2, hash en desync): the client writes its state serialization to IndexedDB under the
// frame of the desyncEvent, so the cause can be compared afterwards (both players' dumps, same frame key).
import type { DesyncEvent } from '@crawlout/protocol';

export const DESYNC_DB = 'crawlout-desync';
export const DESYNC_STORE = 'dumps';

export interface DesyncDump {
  /** Key: the frame of the desyncEvent. */
  frame: number;
  /** Sim.frame of the dumped state; can be a few frames later (the relay stops bundles after a desync, so at most DELAY). */
  simFrame: number;
  /** State hash of the dumped state. */
  hash: number;
  playerId: number;
  hashes: Record<string, number>;
  savedAt: number;
  state: ArrayBuffer;
}

export function buildDesyncDump(event: DesyncEvent, playerId: number, state: { frame: number; hash: number; buffer: ArrayBuffer }, savedAt: number): DesyncDump {
  return { frame: event.frame, simFrame: state.frame, hash: state.hash, playerId, hashes: { ...event.hashes }, savedAt, state: state.buffer };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-fout'));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const open = factory.open(DESYNC_DB, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(DESYNC_STORE, { keyPath: 'frame' });
  };
  return request(open);
}

export async function saveDesyncDump(dump: DesyncDump, factory: IDBFactory = indexedDB): Promise<void> {
  const db = await openDb(factory);
  try {
    const tx = db.transaction(DESYNC_STORE, 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-transactie mislukt'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-transactie afgebroken'));
    });
    tx.objectStore(DESYNC_STORE).put(dump);
    await done;
  } finally {
    db.close();
  }
}

export async function readDesyncDump(frame: number, factory: IDBFactory = indexedDB): Promise<DesyncDump | undefined> {
  const db = await openDb(factory);
  try {
    return (await request(db.transaction(DESYNC_STORE, 'readonly').objectStore(DESYNC_STORE).get(frame))) as DesyncDump | undefined;
  } finally {
    db.close();
  }
}
