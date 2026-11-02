// Whether the disk holding the APX home is running out: read when the panel connects and when the core says it
// changed (storage.changed), for the corner card that leads to Settings › Storage.
import type { DiskStatus } from "@apx/protocol";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";

const store = createStore<{ disk?: DiskStatus }>({});

export async function loadDiskStatus(): Promise<void> {
  try {
    store.set({ disk: await client.call("storage.status", {}) });
  } catch {
    // An older core without it: no warning, nothing else changes.
  }
}

export const useDiskStatus = () => useSlice(store, (s) => s.disk);

/** "3.2 GB", "850 MB": free space, said plainly. */
export const freeText = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
