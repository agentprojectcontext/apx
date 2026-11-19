import type { ExtensionInfo } from "@apx/protocol";
import { client } from "../data/client.ts";
import type { MessageKey } from "../i18n/index.ts";
import { extensionsChanged } from "../resources/extensionInstall.ts";
import type { Item } from "../resources/extensionItems.ts";
import { refusalOf } from "./about.ts";

// Adding one from a catalog, on its own page: its files are copied and nothing runs, and the page stays, now added,
// with Connect as the next step the owner takes (DECISIONS.md#d-255). The add box uses the same refusals in words.

export type Problem = { key: MessageKey; vars?: Record<string, string>; detail?: string; retry?: boolean };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A refusal in the owner's words: what happened and what to do. */
export function problemOf(e: unknown, name: string, version: string | undefined): Problem {
  const r = refusalOf(e);
  const detail = errText(e);
  if (r?.reason === "download") return { key: "box.err.download", detail, retry: true };
  if (r?.reason === "changed") return { key: "box.err.changed", detail, retry: true };
  if (r?.reason === "newer_apx")
    return r.needs
      ? { key: "box.err.newerVersion", vars: { name, version: r.needs }, detail }
      : { key: "box.err.newer", vars: { name }, detail };
  if (r?.reason === "invalid") return { key: "box.err.invalid", detail };
  return { key: "box.err.other", vars: { name, version: version ?? "" }, detail, retry: true };
}

/** It has nothing to connect: no server, key, setting to fill, app to pair or code of its own. */
export const nothingToConnect = (e: ExtensionInfo) =>
  !e.mcp.length && !e.secrets.length && !e.companion && !e.plugin && !e.settings.some((s) => s.required && !s.set);

/** Where a catalog's entry is added from: an added catalog's entry, or APX's package by its address. */
export function addSource(i: Item): { entry: { catalog: string; id: string } } | { url: string } | undefined {
  if (i.state !== "available" || i.channel || i.integration) return undefined;
  if (i.entry?.catalog) return { entry: { catalog: i.entry.catalog, id: i.id } };
  return i.url ? { url: i.url } : undefined;
}

/**
 * Copies its files after checking them: one chosen from APX's catalog must be the files APX publishes. One with
 * nothing to connect is turned on as it is added; the rest wait, added, for Connect.
 */
export async function addItem(i: Item): Promise<{ ext: ExtensionInfo } | { problem: Problem }> {
  const source = addSource(i);
  if (!source) return { problem: { key: "box.err.other", vars: { name: i.name, version: i.version ?? "" } } };
  let seen: ExtensionInfo | undefined;
  try {
    seen = await client.call("extensions.inspect", source);
    if (i.provenance === "official" && !i.entry?.catalog && seen.provenance !== "official" && !seen.catalog)
      return { problem: { key: "box.err.mismatch", vars: { name: seen.name, version: seen.version } } };
    const done = await client.call("extensions.install", { ...source, hash: seen.hash });
    const ext =
      !done.enabled && nothingToConnect(done)
        ? await client.call("extensions.enable", { id: done.id, enabled: true })
        : done;
    extensionsChanged();
    return { ext };
  } catch (e) {
    return { problem: problemOf(e, seen?.name ?? i.name, seen?.version ?? i.version) };
  }
}

/** A list row's Add opens the page, which adds it there: the owner sees it happen and stays on it after. */
let asked: string | undefined;
export const askToAdd = (key: string) => {
  asked = key;
};
/** Whether the page just opened was asked to add it (only once). */
export function takeAsked(key: string): boolean {
  if (asked !== key) return false;
  asked = undefined;
  return true;
}
