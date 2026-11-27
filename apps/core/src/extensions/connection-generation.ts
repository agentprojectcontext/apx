import { createHash, randomUUID } from "node:crypto";
import type { ExtensionRecord } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { conflict } from "../errors.ts";

const key = (id: string) => `extension_connection_generation:${id}`;

export function connectionGeneration(
  store: Store,
  extension: Pick<ExtensionRecord, "id" | "hash" | "installed_at" | "enabled">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        extension.id,
        extension.hash,
        extension.installed_at,
        extension.enabled,
        store.settings.get(key(extension.id)) ?? "",
      ]),
    )
    .digest("hex");
}

export function connectionGenerationFields(store: Store, id: string | undefined): { connection_generation?: string } {
  const extension = id ? store.extensions.get(id) : undefined;
  return extension ? { connection_generation: connectionGeneration(store, extension) } : {};
}

export function invalidateConnection(store: Store, id: string): void {
  if (!store.extensions.get(id)) return;
  store.settings.set(key(id), randomUUID());
}

export function checkConnectionGeneration(store: Store, id: string, expected: string | undefined): void {
  const extension = store.extensions.get(id);
  if (!extension || !expected || connectionGeneration(store, extension) !== expected)
    throw conflict("This connection attempt is no longer current; start connecting again");
}
