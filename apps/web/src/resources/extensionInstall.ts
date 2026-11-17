import { useSyncExternalStore } from "react";

// Whether the extension install dialog is asked for, and with which file: kept apart from the dialog, which loads
// lazily. `installed` counts installs, so an open Extensions tab reads its list again.

export type InstallMode = "file" | "url" | "folder";
type Request = { file?: File; mode?: InstallMode };
let request: Request | undefined;
let installed = 0;
const subs = new Set<() => void>();
const changed = () => {
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Opens the dialog on `mode`; with `file`, already read (a double-clicked or dropped .apxext). */
export function openExtensionInstall(open: Request = {}): void {
  request = open;
  changed();
}

export function closeExtensionInstall(): void {
  request = undefined;
  changed();
}

export function extensionInstalled(): void {
  installed++;
  changed();
}

export function useExtensionInstall(): Request | undefined {
  return useSyncExternalStore(subscribe, () => request);
}

export function useExtensionsInstalled(): number {
  return useSyncExternalStore(subscribe, () => installed);
}
