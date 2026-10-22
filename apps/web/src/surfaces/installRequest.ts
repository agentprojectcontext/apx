import { useSyncExternalStore } from "react";

// Whether the install dialog is asked for, and for which project: kept apart from the dialog, which loads lazily.

let request: { project?: string } | undefined;
const subs = new Set<() => void>();
const changed = () => {
  for (const f of subs) f();
};

/** Opens the install dialog, with `project` chosen as the destination. */
export function openInstall(project?: string): void {
  request = project ? { project } : {};
  changed();
}

export function closeInstall(): void {
  request = undefined;
  changed();
}

export function useInstallRequest(): { project?: string } | undefined {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => request,
  );
}
