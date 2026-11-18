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
/**
 * Its label on screen: comes with APX, published by APX (its files match), from someone else (another catalog, a file
 * or address someone gave), or the owner's own (a folder they built, a server they added by its address or command).
 */
export type Label = "included" | "official" | "third" | "own";
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
  label: Label;
  provenance: "included" | ExtensionInfo["provenance"];
  /** Who makes it, as its listing says (APX for its own catalog when the listing says nothing). */
  publisher?: string | undefined;
  /** When the catalog published the version it offers (ISO date). */
  published?: string | undefined;
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
  /** The server it runs, when APX knows it: an account's, or one the owner added by its address or command. */
  server?: McpServerStatus;
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
    label: own ? "included" : "official",
    provenance: own ? "included" : "official",
    publisher: "APX",
    connection: i.oauth || !i.fields.length ? "oauth" : "key",
    brings: ["accounts", "tools"],
    needs: [],
    state: i.coming ? "coming" : !i.connected ? "available" : attention ? "attention" : "on",
    attention,
    here: Boolean(project && i.connected && !i.off_in.includes(project)),
    integration: i,
    ...(server ? { server } : {}),
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
    label: "included",
    provenance: "included",
    publisher: "APX",
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
  const label: Label =
    e.provenance === "official" ? "official" : !entry?.catalog && FOLDER.test(e.source) ? "own" : "third";
  return {
    key: `ext:${e.id}`,
    id: e.id,
    name: e.name,
    description: e.description || entry?.description || "",
    tagline: listing?.tagline ?? entry?.tagline,
    category: listing?.category ?? entry?.category,
    origin: entry && e.provenance === "official" ? "catalog" : "own",
    label,
    provenance: e.provenance,
    // The catalog's publisher speaks for its own files only: a copy from elsewhere says who made it itself, or nothing.
    publisher: e.provenance === "official" ? (listing?.publisher?.name ?? "APX") : e.listing?.publisher?.name,
    connection: listing?.connection,
    brings: e.brings,
    needs: e.needs,
    state: attention ? "attention" : e.enabled ? "on" : "off",
    attention,
    version: known(e.version),
    update,
    url: update ? entry?.url : undefined,
    listing,
    // Its servers are global: on wherever it is on.
    here: e.enabled,
    ext: e,
    ...(entry ? { entry } : {}),
  };
}

/** A folder on this computer: the owner built it (or keeps it) there. */
const FOLDER = /^(~|\/|[A-Za-z]:[\\/])/;

/** One the owner added in APX by its address or command: their own extension, with the tools its server has. */
function fromServer(s: McpServerStatus): Item {
  const url = s.definition?.url;
  const attention: Attention | undefined =
    s.status === "needs-sign-in" ? "sign-in" : s.status === "error" ? "error" : undefined;
  return {
    key: `mcp:${s.name}`,
    id: s.name,
    name: s.name,
    description: url ? (URL.parse(url)?.host ?? url) : s.target,
    origin: "own",
    label: "own",
    provenance: "third_party",
    brings: ["tools"],
    needs: url ? [] : ["code"],
    state: !s.enabled ? "off" : attention ? "attention" : "on",
    attention,
    here: s.enabled,
    server: s,
  };
}

/** A plugin that never said its version is listed without one. */
const known = (v: string) => (v === "0.0.0" ? undefined : v);

function offered(c: CatalogEntry): Item {
  return {
    key: c.catalog ? `added:${c.catalog}:${c.id}` : `catalog:${c.id}`,
    id: c.id,
    name: c.name,
    description: c.description,
    tagline: c.listing?.tagline ?? c.tagline,
    category: c.listing?.category ?? c.category,
    origin: "catalog",
    label: c.provenance === "official" ? "official" : "third",
    provenance: c.provenance,
    publisher: c.listing?.publisher?.name ?? (c.provenance === "official" ? "APX" : undefined),
    published: c.published_at,
    connection: c.listing?.connection,
    brings: c.brings ?? [],
    needs: c.needs ?? [],
    state: "available",
    version: known(c.version),
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
  // One installed from an added catalog keeps its place there (its source names the entry it came from).
  const fromAdded = (e: ExtensionInfo) =>
    src.catalog.find((c) => c.catalog && c.id === e.id && e.source.endsWith(` · ${c.name}`));
  const mine = new Set(src.installed.map((e) => e.id));
  const packaged = new Set([...byId.keys(), ...mine]);
  const connected = new Set(src.integrations.filter((i) => i.connected && !i.own).map((i) => i.id));
  // The servers an account or an extension runs are shown as that account or extension, never on their own.
  const taken = new Set([...src.integrations.map((i) => i.id), ...src.installed.flatMap((e) => e.mcp)]);
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
            label: "included" as const,
            provenance: "included" as const,
            publisher: "APX",
            connection: "local" as const,
            brings: ["tools" as const],
            needs: [],
            state: "on" as const,
            here: true,
            builtin: "browser" as const,
          },
        ]
      : []),
    ...src.installed.map((e) => installed(e, byId.get(e.id) ?? fromAdded(e))),
    ...src.servers.filter((s) => s.scope === "global" && s.definition && !taken.has(s.name)).map(fromServer),
    ...src.catalog
      .filter((c) => !mine.has(c.id) && !connected.has(c.id) && (!c.catalog || !byId.has(c.id)))
      .map(offered),
  ];
}

/** It waits on the owner: something to fix, an update, or installed and still off. */
export const waits = (i: Item) => i.state === "attention" || i.state === "off" || Boolean(i.update);

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

/** The owner's own: what waits on them (not connected, a new version, an error) first, then what is working. */
export function groupMine(items: Item[]): Group[] {
  const mine = items.filter(isMine);
  return [
    { id: "attention", items: mine.filter(waits) },
    { id: "active", items: mine.filter((i) => !waits(i)) },
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
