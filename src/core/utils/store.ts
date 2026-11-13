/**
 * Minimal in-memory store for state that must survive extension-page switches
 * but need not persist across app restarts.
 */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  /** Returns an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
}

/** Create a {@link Store} */
export function createStore<T extends object>(initial: T): Store<T> {
  let state: T = { ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
