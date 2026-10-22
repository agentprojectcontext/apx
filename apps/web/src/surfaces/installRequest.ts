import { useSyncExternalStore } from "react";

// Whether the install dialog is asked for, and for which project: kept apart from the dialog, which loads lazily.

type InstallRequest = { project?: string; file?: File };
let request: InstallRequest | undefined;
const subs = new Set<() => void>();
const changed = () => {
  for (const f of subs) f();
};

/** Opens the install dialog, with `project` chosen as the destination and `file` already read. */
export function openInstall(project?: string, file?: File): void {
  request = { ...(project ? { project } : {}), ...(file ? { file } : {}) };
  changed();
}

export function closeInstall(): void {
  request = undefined;
  changed();
}

export function useInstallRequest(): InstallRequest | undefined {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => request,
  );
}
