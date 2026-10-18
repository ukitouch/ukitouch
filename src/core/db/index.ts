/**
 * Storage-layer public surface: model types + repositories.
 * Transaction plumbing (db.ts) stays internal to the store.
 */
export * from "./types";
export * as deviceRepo from "./deviceRepo";
export * as eventRepo from "./eventRepo";

/**
 * IndexedDB connection and transaction infrastructure.
 *
 * - Singleton connection: openDB() caches the promise, one IDBDatabase per process;
 * - Schema evolution: bump DB_VERSION and add a branch in upgrade(), old data upgrades
 *   automatically on next open;
 * - Transactions: withTx() wraps completion/failure semantics so repository layers
 *   never touch raw IDB events.
 */
import { DB_NAME, DB_VERSION } from "./types";

/** Object stores involved in transactions. Extend when a store is added. */
export type StoreName = "devices" | "connectionEvents";

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (upgrading if needed) the database; cached per process. */
export function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (ev) =>
        upgrade(request.result, ev.oldVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("indexedDB open failed"));
    });
  }
  return dbPromise;
}

/**
 * Schema migrations, applied in order of oldVersion.
 * Example: adding a kv store later →
 *   `if (oldVersion < 2) { db.createObjectStore("kv", { keyPath: "key" }); }`
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
      // transaction already aborted by a failed request; nothing to do
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

/** Iterate a cursor; return true from visit to stop early. */
export function eachCursor<T>(
  source: IDBIndex | IDBObjectStore,
  range: IDBKeyRange | null,
  direction: IDBCursorDirection,
  visit: (value: T) => boolean | void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(range, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (visit(cursor.value as T)) {
        resolve();
        return;
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB cursor failed"));
  });
}
