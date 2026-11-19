import { createHash } from "node:crypto";
import type { CatalogItem, CatalogVia } from "../domain/extension-catalogs.ts";
import { extensionId } from "./claude-plugin.ts";

function sourceKey(source: unknown): string | undefined {
  if (typeof source === "string") return `path:${source.replace(/^\.\//, "")}`;
  if (!source || typeof source !== "object") return undefined;
  const s = source as { source?: string; url?: string; repo?: string; path?: string };
  const url = s.source === "github" && s.repo ? `https://github.com/${s.repo}.git` : s.url;
  return url ? `git:${url}:${s.source === "git-subdir" ? (s.path ?? "") : ""}` : undefined;
}

const previousKey = (via: CatalogVia) =>
  via.type === "path" ? `path:${via.path}` : via.type === "git" ? `git:${via.url}:${via.path ?? ""}` : undefined;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Assign unique ids while retaining the identity previously reachable for each plugin. */
export function catalogPluginIds(plugins: unknown[], previous: CatalogItem[]): Map<number, string> {
  const candidates = plugins
    .map((plugin, index) => {
      const p = plugin as { name?: unknown; displayName?: unknown; source?: unknown } | null;
      const name = typeof p?.name === "string" ? p.name : "";
      return {
        index,
        name,
        shown: typeof p?.displayName === "string" ? p.displayName : name,
        key: sourceKey(p?.source),
      };
    })
    .filter((p) => p.name)
    .sort((a, b) => compare(a.name, b.name) || compare(a.key ?? "", b.key ?? ""));
  const ids = new Map<number, string>();
  const used = new Set<string>();
  const reserved = new Set(candidates.map((p) => extensionId(p.name)));
  for (const old of previous) {
    const key = previousKey(old.via);
    const matches = key ? candidates.filter((p) => p.key === key && !ids.has(p.index)) : [];
    const match = matches.find((p) => p.shown === old.name) ?? (matches.length === 1 ? matches[0] : undefined);
    if (match && !used.has(old.id)) {
      ids.set(match.index, old.id);
      used.add(old.id);
    }
  }
  for (const p of candidates) {
    if (ids.has(p.index)) continue;
    const base = extensionId(p.name);
    let id = base;
    for (let salt = 0; used.has(id); salt++) {
      const digest = createHash("sha256")
        .update(`${p.name}\0${p.key ?? ""}\0${salt}`)
        .digest("hex")
        .slice(0, 6);
      id = `${base.slice(0, 13).replace(/[-_]+$/, "")}-${digest}`;
      if (reserved.has(id)) id = base;
    }
    ids.set(p.index, id);
    used.add(id);
  }
  return ids;
}
