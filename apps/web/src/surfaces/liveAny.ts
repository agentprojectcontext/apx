import { useSyncExternalStore } from "react";

// Whether any page is live, apart from the pool: the shell mounts the live layer on it without loading the pool.

let any = false;
const subs = new Set<() => void>();

export function setAnyLive(next: boolean): void {
  if (next === any) return;
  any = next;
  for (const f of subs) f();
}

export function useAnyLive(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => any,
  );
}
