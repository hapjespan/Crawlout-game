// Desync dump (contract 2, hash en desync): the client writes its state serialization to IndexedDB, keyed by savedAt
// (two matches desyncing at the same frame must not overwrite each other), with the frame of the desyncEvent inside so
// both players' dumps can be compared afterwards. Only the last DESYNC_KEEP dumps are kept.
import type { DesyncEvent } from '@crawlout/protocol';

export const DESYNC_DB = 'crawlout-desync';
export const DESYNC_STORE = 'dumps';
const DESYNC_DB_VERSION = 2;
const DESYNC_KEEP = 5;

export interface DesyncDump {
  /** The frame of the desyncEvent. */
  frame: number;
  /** Sim.frame of the dumped state; can be a few frames later (the relay stops bundles after a desync, so at most DELAY). */
  simFrame: number;
  /** State hash of the dumped state. */
  hash: number;
  playerId: number;
  hashes: Record<string, number>;
  /** Key: Date.now() when saved. */
  savedAt: number;
  state: ArrayBuffer;
}

export function buildDesyncDump(
  event: DesyncEvent,
  playerId: number,
  state: { frame: number; hash: number; buffer: ArrayBuffer },
  savedAt: number,
): DesyncDump {
  return {
    frame: event.frame,
    simFrame: state.frame,
    hash: state.hash,
    playerId,
    hashes: { ...event.hashes },
    savedAt,
    state: state.buffer,
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-fout'));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const open = factory.open(DESYNC_DB, DESYNC_DB_VERSION);
  open.onupgradeneeded = () => {
    // version 1 keyed by frame: drop it (old dumps go) and key by savedAt
    if (open.result.objectStoreNames.contains(DESYNC_STORE))
      open.result.deleteObjectStore(DESYNC_STORE);
    open.result.createObjectStore(DESYNC_STORE, { keyPath: 'savedAt' });
  };
  return request(open);
}

export async function saveDesyncDump(
  dump: DesyncDump,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  const db = await openDb(factory);
  try {
    const tx = db.transaction(DESYNC_STORE, 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-transactie mislukt'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-transactie afgebroken'));
    });
    const store = tx.objectStore(DESYNC_STORE);
    store.put(dump);
    // keys come back ascending (oldest savedAt first); delete in the same transaction
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      for (const key of keys.result.slice(0, Math.max(0, keys.result.length - DESYNC_KEEP)))
        store.delete(key);
    };
    await done;
  } finally {
    db.close();
  }
}
