import {
  DB_NAME,
  DB_VERSION,
  StoreName,
  type ConnectionEvent,
  type DeviceRecord,
} from "./types";

let dbPromise: Promise<IDBDatabase> | null = null;

/** 
 * Open (upgrading if needed) the database.
 * 
 * Cached per process.
 */
function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (ev) => upgrade(request, ev.oldVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    });
  }
  return dbPromise;
}

/**
 * Schema migrations, applied in order of oldVersion.
 * 
 * This is used when a new schema is needed. At the same time {@link DB_VERSION}
 * should be raised.
 */
function upgrade(request: IDBOpenDBRequest, oldVersion: number): void {
  const db = request.result;
  const tx = request.transaction;
  if (!tx) return;
  if (oldVersion < 1) {
    db.createObjectStore("devices", { keyPath: "uuid" });
    const events = db.createObjectStore("connectionEvents", {
      keyPath: "id",
      autoIncrement: true,
    });
    events.createIndex("byDevice", "uuid");
    events.createIndex("byTime", "time");
  }
  if (oldVersion < 2) {
    // V2: rename "p2p" protocol to "webrtc"
    for (const store of ["devices", "connectionEvents"] as const) {
      const cursor = tx.objectStore(store).openCursor();
      cursor.onsuccess = () => {
        const cur = cursor.result;
        if (!cur) return;
        const rec = cur.value as DeviceRecord | ConnectionEvent;
        if ((rec.protocol as string) === "p2p") {
          rec.protocol = "webrtc";
          cur.update(rec);
        }
        cur.continue();
      };
    }
  }
}

/** Promisify an IDBRequest. */
export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB request failed"));
  });
}

/** Run fn inside a transaction; await commit on success, abort and rethrow on failure. */
export async function withTx<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(stores, mode);
  let result: T;
  try {
    result = await fn(tx);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // transaction already aborted by a failed request
    }
    throw err;
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB transaction aborted"));
  });
  return result;
}

export * from "./types";
export * as deviceRepo from "./deviceRepo";
export * as eventRepo from "./eventRepo";
