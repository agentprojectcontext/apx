import { useSyncExternalStore } from "react";

export type Store<S> = {
  get: () => S;
  set: (next: Partial<S> | ((s: S) => Partial<S>)) => void;
  subscribe: (fn: () => void) => () => void;
};

/** Minimal external store: shallow-merged updates, React reads it with useSyncExternalStore. */
export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const patch = typeof next === "function" ? next(state) : next;
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Subscribe to a slice. The selector must return a stable reference (a stored value, not a new array). */
export function useSlice<S extends object, T>(store: Store<S>, select: (s: S) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}
