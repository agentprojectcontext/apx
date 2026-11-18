import type { CatalogEntry, ExtensionListing } from "@apx/protocol";
import { useSyncExternalStore } from "react";

// Whether the add box is asked for, and from where: kept apart from the box, which loads lazily. `installed` counts
// changes to what the owner has, so an open Marketplace reads its lists again.

export type InstallMode = "file" | "url" | "folder";
type Request = {
  /** A double-clicked or dropped .apxext, already chosen. */
  file?: File;
  /** The picker's tab to open on (adding from elsewhere). */
  mode?: InstallMode;
  /** A package's address. */
  url?: string;
  /** An entry of a catalog the owner added (`name`: that catalog's, to say where it comes from). */
  entry?: { catalog: string; id: string; name?: string };
  /** Chosen from a catalog's list: the box opens on it directly, without the picker. */
  catalog?: boolean;
  /** From APX's catalog as official: its files must be the ones APX publishes. */
  official?: boolean;
  /** One already added, to connect or pair. */
  connect?: string;
  /** How its page shows it (its listing and catalog entry), for its icon. */
  look?: { listing?: ExtensionListing | undefined; entry?: CatalogEntry | undefined };
};
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

export function openExtensionInstall(open: Request = {}): void {
  request = open;
  changed();
}

export function closeExtensionInstall(): void {
  request = undefined;
  changed();
}

/** Something the owner has changed (here, in another window, from the terminal or by an agent): lists read again. */
export function extensionsChanged(): void {
  installed++;
  changed();
}

export function useExtensionInstall(): Request | undefined {
  return useSyncExternalStore(subscribe, () => request);
}

export function useExtensionsInstalled(): number {
  return useSyncExternalStore(subscribe, () => installed);
}
