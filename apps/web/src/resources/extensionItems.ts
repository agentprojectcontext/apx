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
  /** Who makes it, as its listing or its catalog says (APX for its own catalog when nothing says). */
  publisher?: string | undefined;
  /** The GitHub account its code lives under, when nobody says who makes it. */
  github?: string | undefined;
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
  /**
   * From a catalog the owner added, the same service as one APX includes or publishes (that one's key): shown as
   * its other version on that one's page, never listed apart (DECISIONS.md#d-253).
   */
  twin?: string;
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
    ...(own ? { category: "productivity" as const } : {}),
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
    publisher:
      e.provenance === "official"
        ? (listing?.publisher?.name ?? "APX")
        : (e.listing?.publisher?.name ?? entry?.publisher),
    github: entry?.github,
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
    publisher: c.listing?.publisher?.name ?? c.publisher ?? (c.provenance === "official" ? "APX" : undefined),
    github: c.github,
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
 * Every extension once: an installed one stands for its catalog entry, a catalog package for the account APX ships as
 * data under the same id (unless that account is connected), and an added catalog's entry that repeats one of APX's
 * is marked as that one's other version.
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
  // APX's own entry stands for an id that an added catalog also lists (that one becomes its other version).
  const byId = new Map(src.catalog.filter((c) => !c.catalog).map((c) => [c.id, c]));
  // One installed from an added catalog keeps its place there (its source names the entry it came from).
  const fromAdded = (e: ExtensionInfo) =>
    src.catalog.find((c) => c.catalog && c.id === e.id && e.source.endsWith(` · ${c.name}`));
  const mine = new Set(src.installed.map((e) => e.id));
  const packaged = new Set([...byId.keys(), ...mine]);
  const connected = new Set(src.integrations.filter((i) => i.connected && !i.own).map((i) => i.id));
  return markTwins([
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
    ...src.catalog.filter((c) => !mine.has(c.id) && (c.catalog || !connected.has(c.id))).map(offered),
  ]);
}

/** A service's name, to tell one listed twice: letters and digits only, without a trailing "MCP", "plugin" or "server". */
export const serviceName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/( (mcp|plugin|server|connector|integration))+$/, "")
    .replaceAll(" ", "");

/** Where its code is kept says nothing of which service it is. */
const CODE_HOST = /(^|\.)(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|npmjs\.com|pypi\.org)$/;
/** The host of its own web page, when it has one that is not a code host. */
const siteOf = (url: string | undefined) => {
  const host = url ? URL.parse(url)?.hostname.replace(/^www\./, "") : undefined;
  return host && !CODE_HOST.test(host) ? host : undefined;
};
/** What tells it apart as a service: its id, its name and its site. */
function marks(i: Item): string[] {
  const name = serviceName(i.name);
  const site = siteOf(i.entry?.homepage ?? i.listing?.links?.website);
  return [`id:${i.id}`, ...(name ? [`name:${name}`] : []), ...(site ? [`site:${site}`] : [])];
}

/** An added catalog's entry, not added yet, that repeats one APX includes or publishes is that one's other version. */
function markTwins(items: Item[]): Item[] {
  const ours = new Map<string, string>();
  for (const i of items)
    if ((i.label === "included" || i.label === "official") && !i.entry?.catalog)
      for (const m of marks(i)) if (!ours.has(m)) ours.set(m, i.key);
  return items.map((i) => {
    if (i.state !== "available" || !i.entry?.catalog) return i;
    const twin = marks(i)
      .map((m) => ours.get(m))
      .find(Boolean);
    return twin ? { ...i, twin } : i;
  });
}

/** What Explore lists: not the owner's own built ones, and one service once (its other versions are on its page). */
export const listed = (i: Item) => i.label !== "own" && !i.twin;

/** It waits on the owner: something to fix, an update, or installed and still off. */
export const waits = (i: Item) => i.state === "attention" || i.state === "off" || Boolean(i.update);

/** Installed or connected: the owner's own list. Channels live in Channels, so they are not repeated here. */
export const isMine = (i: Item) => i.state !== "available" && i.state !== "coming" && !i.channel;

export type Group = { id: string; items: Item[] };

/**
 * What an extension is, read from what it brings (DECISIONS.md#d-250): a channel APX talks through, an integration
 * (APX's own, or one with code or an app of its own), a connector (an MCP server, maybe with skills to use it),
 * ready-made agents, or skills alone.
 */
export type Kind = "channel" | "native" | "integration" | "connector" | "agents" | "skills";

export function kindOf(i: Item): Kind {
  if (i.channel) return "channel";
  if (i.builtin || i.integration?.own) return "native";
  const e = i.ext;
  const c = i.entry?.contents;
  const brings = (...b: ExtensionBrings[]) => b.some((x) => i.brings.includes(x));
  if (e?.plugin || e?.companion || e?.apps.length || c?.companion || brings("devices", "apps")) return "integration";
  if (i.integration || i.server || e?.mcp.length || c?.servers || brings("tools", "accounts")) return "connector";
  if (e?.agents.length || c?.agents.length || brings("agents")) return "agents";
  return "skills";
}

/**
 * Every category, included ones in theirs (marked Included) and an added catalog's beside them; the channels
 * together; then accounts not filed yet, and last, each added catalog's entries that fit no category.
 */
export function groupByCategory(items: Item[]): Group[] {
  const byCat = new Map<string, Item[]>();
  for (const i of items) {
    const k = i.channel
      ? "channels"
      : (i.category ?? (i.entry?.catalog ? `added:${i.entry.catalog}` : i.integration ? "accounts" : "other"));
    byCat.set(k, [...(byCat.get(k) ?? []), i]);
  }
  const last = (k: string) =>
    k.startsWith("added:") ? 4 : k === "other" ? 3 : k === "accounts" ? 2 : k === "channels" ? 1 : 0;
  return [
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
