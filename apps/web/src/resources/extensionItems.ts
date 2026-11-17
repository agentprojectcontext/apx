import type {
  CatalogEntry,
  ExtensionBrings,
  ExtensionCategory,
  ExtensionConnection,
  ExtensionInfo,
  ExtensionListing,
  ExtensionNeeds,
  McpServerStatus,
  Result,
} from "@apx/protocol";

// The Marketplace as one list: what is included with APX (code of its own: Google, the channels, the browser), APX's
// catalog (its packages, and the account integrations APX ships as data until the catalog lists them) and the owner's
// own, each in the same shape so the screen groups, filters and opens them alike.

export type Integration = Result<"integrations.list">["integrations"][number];

/** Included with APX, from APX's catalog, or the owner's own (a file, a folder, an address). */
type Origin = "included" | "catalog" | "own";
/** Shown on the row: not here yet, coming, installed but off, working, or waiting on the owner. */
type ItemState = "available" | "coming" | "off" | "on" | "attention";
/** Why one waits on the owner. */
type Attention = "keys" | "settings" | "sign-in" | "error" | "update-waits" | "plugin";

export type Item = {
  key: string;
  id: string;
  name: string;
  description: string;
  tagline?: string | undefined;
  category?: ExtensionCategory | undefined;
  origin: Origin;
  provenance: "included" | ExtensionInfo["provenance"];
  connection?: ExtensionConnection | undefined;
  brings: ExtensionBrings[];
  needs: ExtensionNeeds[];
  state: ItemState;
  attention?: Attention | undefined;
  version?: string | undefined;
  /** A newer version in the catalog. */
  update?: string | undefined;
  /** Where to install it (or its newer version) from. */
  url?: string | undefined;
  listing?: ExtensionListing | undefined;
  /** On in the open project. */
  here: boolean;
  ext?: ExtensionInfo;
  entry?: CatalogEntry;
  integration?: Integration;
  /** A channel APX talks through (its setup is the channel's own). */
  channel?: string;
  /** Part of APX with settings of its own (the browser). */
  builtin?: "browser";
};

/** A channel kind as the screen names it: its name and line come from the channel's own texts. */
export type ChannelOffer = { kind: string; name: string; description: string; connected: boolean };

/** "1.10.0" after "1.9.2"; a pre-release before its release. */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) => {
    const [core = "", pre] = v.split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d > 0;
  }
  return x.pre === undefined && y.pre !== undefined;
}

function fromIntegration(i: Integration, servers: McpServerStatus[], project: string | undefined): Item {
  const server = servers.find((s) => s.scope === "global" && s.name === i.id);
  const attention: Attention | undefined = !i.connected
    ? undefined
    : server?.status === "needs-sign-in"
      ? "sign-in"
      : server?.status === "error"
        ? "error"
        : undefined;
  const own = Boolean(i.own);
  return {
    key: `${own ? "included" : "account"}:${i.id}`,
    id: i.id,
    name: i.label,
    description: i.description,
    // With code of its own it stays included; the rest are APX's data, on their way to its catalog.
    origin: own ? "included" : "catalog",
    provenance: own ? "included" : "official",
    connection: i.oauth || !i.fields.length ? "oauth" : "key",
    brings: ["accounts", "tools"],
    needs: [],
    state: i.coming ? "coming" : !i.connected ? "available" : attention ? "attention" : "on",
    attention,
    here: Boolean(project && i.connected && !i.off_in.includes(project)),
    integration: i,
  };
}

function fromChannel(c: ChannelOffer): Item {
  return {
    key: `channel:${c.kind}`,
    id: c.kind,
    name: c.name,
    description: c.description,
    category: "communication",
    origin: "included",
    provenance: "included",
    connection: "local",
    brings: ["accounts"],
    needs: [],
    state: c.connected ? "on" : "available",
    here: c.connected,
    channel: c.kind,
  };
}

function installed(e: ExtensionInfo, entry: CatalogEntry | undefined): Item {
  const missing = e.enabled && e.secrets.some((s) => !s.set);
  const unset = e.enabled && e.settings.some((s) => s.required && !s.set && s.value === undefined);
  const attention: Attention | undefined = !e.enabled
    ? e.update?.adds.length
      ? "update-waits"
      : undefined
    : e.plugin?.status === "error"
      ? "plugin"
      : missing
        ? "keys"
        : unset
          ? "settings"
          : undefined;
  const update = entry && newer(entry.version, e.version) ? entry.version : undefined;
  const listing = e.listing ?? entry?.listing;
  return {
    key: `ext:${e.id}`,
    id: e.id,
    name: e.name,
    description: e.description || entry?.description || "",
    tagline: listing?.tagline ?? entry?.tagline,
    category: listing?.category ?? entry?.category,
    origin: entry && e.provenance === "official" ? "catalog" : "own",
    provenance: e.provenance,
    connection: listing?.connection,
    brings: e.brings,
    needs: e.needs,
    state: attention ? "attention" : e.enabled ? "on" : "off",
    attention,
    version: e.version,
    update,
    url: update ? entry?.url : undefined,
    listing,
    // Its servers are global: on wherever it is on.
    here: e.enabled,
    ext: e,
    ...(entry ? { entry } : {}),
  };
}

function offered(c: CatalogEntry): Item {
  return {
    key: c.catalog ? `added:${c.catalog}:${c.id}` : `catalog:${c.id}`,
    id: c.id,
    name: c.name,
    description: c.description,
    tagline: c.listing?.tagline ?? c.tagline,
    category: c.listing?.category ?? c.category,
    origin: "catalog",
    provenance: c.provenance,
    connection: c.listing?.connection,
    brings: c.brings ?? [],
    needs: c.needs ?? [],
    state: "available",
    version: c.version,
    url: c.url,
    listing: c.listing,
    here: false,
    entry: c,
  };
}

/**
 * Every extension once: an installed one stands for its catalog entry, and a catalog package for the account APX
 * ships as data under the same id (unless that account is connected).
 */
export function buildItems(src: {
  integrations: Integration[];
  channels?: ChannelOffer[];
  /** APX's browser, by its name and line in the owner's language. */
  browser?: { name: string; description: string };
  catalog: CatalogEntry[];
  installed: ExtensionInfo[];
  servers: McpServerStatus[];
  project?: string | undefined;
}): Item[] {
  // APX's own entry stands for an id that an added catalog also lists.
  const byId = new Map(src.catalog.filter((c) => !c.catalog).map((c) => [c.id, c]));
  const mine = new Set(src.installed.map((e) => e.id));
  const packaged = new Set([...byId.keys(), ...mine]);
  const connected = new Set(src.integrations.filter((i) => i.connected && !i.own).map((i) => i.id));
  return [
    ...src.integrations
      .filter((i) => i.own || i.connected || !packaged.has(i.id))
      .map((i) => fromIntegration(i, src.servers, src.project)),
    ...(src.channels ?? []).map(fromChannel),
    ...(src.browser
      ? [
          {
            key: "included:browser",
            id: "browser",
            name: src.browser.name,
            description: src.browser.description,
            category: "productivity" as const,
            origin: "included" as const,
            provenance: "included" as const,
            connection: "local" as const,
            brings: ["tools" as const],
            needs: [],
            state: "on" as const,
            here: true,
            builtin: "browser" as const,
          },
        ]
      : []),
    ...src.installed.map((e) => installed(e, byId.get(e.id))),
    ...src.catalog
      .filter((c) => !mine.has(c.id) && !connected.has(c.id) && (!c.catalog || !byId.has(c.id)))
      .map(offered),
  ];
}

/** It waits on the owner: something to fix, an update, or installed and still off. */
const waits = (i: Item) => i.state === "attention" || i.state === "off" || Boolean(i.update);

/** Installed or connected: the owner's own list. */
export const isMine = (i: Item) => i.state !== "available" && i.state !== "coming";

export type Group = { id: string; items: Item[] };

/** Included first, then the catalog by category, then APX's accounts not filed in a category yet. */
export function groupByCategory(items: Item[]): Group[] {
  const included = items.filter((i) => i.origin === "included");
  const byCat = new Map<string, Item[]>();
  for (const i of items.filter((x) => x.origin !== "included")) {
    // An added catalog's entries stay together under it.
    const k = i.entry?.catalog ? `added:${i.entry.catalog}` : (i.category ?? (i.integration ? "accounts" : "other"));
    byCat.set(k, [...(byCat.get(k) ?? []), i]);
  }
  const last = (k: string) => (k.startsWith("added:") ? 3 : k === "accounts" ? 1 : k === "other" ? 2 : 0);
  return [
    ...(included.length ? [{ id: "included", items: included }] : []),
    ...[...byCat.entries()]
      .sort(([a, x], [b, y]) => last(a) - last(b) || y.length - x.length || a.localeCompare(b))
      .map(([id, items]) => ({ id, items })),
  ];
}

/** The owner's own: what waits on them first, then what is on here, then the rest. */
export function groupMine(items: Item[], project: string | undefined): Group[] {
  const mine = items.filter(isMine);
  const rest = mine.filter((i) => !waits(i));
  return [
    { id: "attention", items: mine.filter(waits) },
    { id: "here", items: project ? rest.filter((i) => i.here) : [] },
    { id: "active", items: project ? rest.filter((i) => !i.here) : rest },
  ].filter((g) => g.items.length);
}

/** By words in its name, line or description, and by what it brings. */
export function filterItems(items: Item[], query: string, brings: ExtensionBrings | ""): Item[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!q || `${i.name} ${i.tagline ?? ""} ${i.description}`.toLowerCase().includes(q)) &&
      (!brings || i.brings.includes(brings)),
  );
}
