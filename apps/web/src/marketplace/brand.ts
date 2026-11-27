import type { Item } from "../resources/extensionItems.ts";

type Branded = Partial<Pick<Item, "entry" | "ext" | "listing">>;

/** Only APX's verified catalog may identify a provider or replace an installed package's mark. */
function officialEntry(item: Branded) {
  const entry = item.entry;
  return entry?.provenance === "official" &&
    !entry.catalog &&
    (!item.ext || (item.ext.provenance === "official" && item.ext.id === entry.id))
    ? entry
    : undefined;
}

export function officialMcpProvider(item: Branded): string | undefined {
  return officialEntry(item)?.mcp_provider;
}

export function iconFiles(item: Branded): { file: string | undefined; fallback: string | undefined; revision: string } {
  const entry = item.entry;
  const avatar = officialEntry(item)?.icon_url;
  const packaged = item.listing?.icon;
  return {
    file: avatar ? "@icon" : (packaged ?? (!item.ext && entry?.icon_url ? "@icon" : undefined)),
    fallback: avatar ? packaged : undefined,
    revision: JSON.stringify([entry?.catalog, entry?.icon_url, entry?.version, entry?.contents?.hash, item.ext?.hash]),
  };
}
