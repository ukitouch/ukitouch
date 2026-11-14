import { DB_NAME, DB_VERSION, StoreName } from "./types";

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
      request.onupgradeneeded = (ev) => upgrade(request.result, ev.oldVersion);
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
function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore("devices", { keyPath: "uuid" });
    const events = db.createObjectStore("connectionEvents", {
      keyPath: "id",
      autoIncrement: true,
    });
    events.createIndex("byDevice", "uuid");
    events.createIndex("byTime", "time");
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
