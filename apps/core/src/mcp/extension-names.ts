import type { ExtensionManifest } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { conflict } from "../errors.ts";

function manualNames(store: Store): Set<string> {
  try {
    const config = JSON.parse(store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: unknown };
    return new Set(config.mcpServers && typeof config.mcpServers === "object" ? Object.keys(config.mcpServers) : []);
  } catch {
    return new Set();
  }
}

export function extensionNameOwners(store: Store, name: string): string[] {
  return store.extensions
    .list()
    .filter((e) => Object.keys(e.manifest.mcp).some((n) => `${e.id}-${n}` === name))
    .map((e) => e.id);
}

/** Ambiguous legacy definitions are not allowed to borrow another server's runtime identity. */
export function extensionNameAssignments(store: Store): Map<string, string | null> {
  const names = new Map<string, string | null>();
  for (const extension of store.extensions.list()) {
    for (const local of Object.keys(extension.manifest.mcp)) {
      const name = `${extension.id}-${local}`;
      names.set(name, names.has(name) ? null : extension.id);
    }
  }
  for (const name of manualNames(store)) names.set(name, null);
  return names;
}

export function ownsExtensionName(store: Store, id: string, name: string): boolean {
  return extensionNameAssignments(store).get(name) === id;
}

export function assertExtensionNames(store: Store, manifest: ExtensionManifest): void {
  const manual = manualNames(store);
  for (const local of Object.keys(manifest.mcp)) {
    const name = `${manifest.id}-${local}`;
    if (manual.has(name) || extensionNameOwners(store, name).some((id) => id !== manifest.id))
      throw conflict(
        `MCP server ${name} already belongs to another connection; rename it before installing or enabling this extension`,
      );
  }
}

export function assertManualName(store: Store, name: string, removing = false): void {
  if (extensionNameOwners(store, name).length && !(removing && manualNames(store).has(name)))
    throw conflict(`MCP server ${name} belongs to an installed extension; choose another name`);
}
