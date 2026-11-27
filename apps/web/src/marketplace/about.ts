import type {
  CatalogEntry,
  ExtensionConnection,
  ExtensionInfo,
  ExtensionListing,
  ExtensionRefusal,
} from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";
import type { Label } from "../resources/extensionItems.ts";
import { listingIn } from "./itemText.ts";
import { settingText } from "./settingText.ts";

// What the add box and an extension's page say about one extension, the same wherever APX learned it: an inspected
// package, an installed one, a catalog entry not added yet, or a server address the owner typed. A fact APX does not
// know is left out.

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Where it comes from, as the box and the page say it. */
export type Origin =
  | { kind: "apx" }
  | { kind: "catalog"; name: string }
  | { kind: "file"; name: string }
  | { kind: "url"; host: string }
  | { kind: "folder"; path: string };

export type About = {
  id: string;
  name: string;
  version?: string | undefined;
  tagline?: string | undefined;
  label: Label;
  publisher?: string | undefined;
  github?: string | undefined;
  origin?: Origin | undefined;
  hosts: string[];
  /** One of its servers connects to an address the owner sets. */
  ownerHost: boolean;
  runsCode: boolean;
  connection?: ExtensionConnection | undefined;
  /** The keys it asks for, by their labels. */
  keys: string[];
  servers: number;
  /** Its tools: named by its listing before it ran (`real: false`), or by its servers once they started. */
  tools?: { names: string[]; real: boolean } | undefined;
  /** Its skills by name, when APX knows them; `skillCount` says how many otherwise. */
  skills?: string[] | undefined;
  skillCount: number;
  agents: string[];
  routines: string[];
  companion?: { name: string; platform: string } | undefined;
  apps: number;
  requirements: string[];
  /** Whether APX publishes these exact files: yes, no, or it could not ask (absent: it does not apply). */
  files?: "official" | "third" | "unknown" | undefined;
  hash?: string | undefined;
  /** For its icon. */
  listing?: ExtensionListing | undefined;
  entry?: CatalogEntry | undefined;
};

/** Its tool names as the owner reads them: `list_customers` → "list customers". */
const toolWords = (name: string) => name.replace(/[_-]+/g, " ").trim();

const listed = (l: ExtensionListing | undefined, lang: string) => {
  const names = listingIn(l, lang)?.tools.map((x) => x.name) ?? [];
  return names.length ? { names, real: false } : undefined;
};

const FOLDER = /^(~|\/|[A-Za-z]:[\\/])/;

/** Where an installed or inspected one came from, read from its source when the box did not say. */
export function originOf(source: string): Origin {
  if (FOLDER.test(source)) return { kind: "folder", path: source };
  const url = URL.parse(source);
  if (url?.protocol === "https:") return { kind: "url", host: url.host };
  const added = / · (.+)$/.exec(source);
  return added?.[1] ? { kind: "catalog", name: added[1] } : { kind: "file", name: source };
}

/** An inspected or installed extension; `tools` once its servers started. */
export function aboutExtension(
  e: ExtensionInfo,
  lang: string,
  opts: {
    label: Label;
    origin?: Origin | undefined;
    tools?: string[] | undefined;
    /** How its page shows it, when the box knows: for its icon. */
    look?: { listing?: ExtensionListing | undefined; entry?: CatalogEntry | undefined } | undefined;
  },
): About {
  const files =
    opts.label === "own"
      ? undefined
      : e.catalog === "unreachable" || e.catalog === "needs_update"
        ? "unknown"
        : e.provenance === "official"
          ? "official"
          : "third";
  return {
    id: e.id,
    name: e.name,
    version: e.version === "0.0.0" ? undefined : e.version,
    tagline: listingIn(e.listing, lang)?.tagline ?? (e.description || undefined),
    label: opts.label,
    publisher: e.listing?.publisher?.name ?? opts.look?.listing?.publisher?.name ?? opts.look?.entry?.publisher,
    github: opts.look?.entry?.github,
    origin: opts.origin ?? originOf(e.source),
    hosts: e.hosts,
    ownerHost: Boolean(e.owner_host),
    runsCode: e.runs_code,
    connection: e.listing?.connection,
    keys: [...e.secrets, ...e.settings.filter((s) => s.sensitive)].map((s) => settingText(s, lang).label),
    servers: e.mcp.length,
    tools: opts.tools?.length ? { names: opts.tools, real: true } : listed(e.listing, lang),
    skills: e.skills,
    skillCount: e.skills.length,
    agents: e.agents.map((a) => a.name),
    routines: e.routines.map((r) => r.name),
    companion: e.companion ? { name: e.companion.name, platform: e.companion.platform } : undefined,
    apps: e.apps.length,
    requirements: listingIn(e.listing, lang)?.requirements ?? [],
    files,
    hash: e.hash,
    listing: e.listing ?? opts.look?.listing,
    entry: opts.look?.entry,
  };
}

/** A catalog entry not added yet: what its package holds, once APX read it. */
export function aboutEntry(c: CatalogEntry, lang: string): About {
  const k = c.contents;
  const copy = listingIn(c.listing, lang);
  return {
    id: c.id,
    name: c.name,
    version: c.version === "0.0.0" ? undefined : c.version,
    tagline: copy?.tagline ?? c.tagline ?? (c.description || undefined),
    label: c.provenance === "official" ? "official" : "third",
    publisher: c.listing?.publisher?.name ?? c.publisher,
    github: c.github,
    origin: c.catalog ? { kind: "catalog", name: c.catalog_name ?? c.catalog } : { kind: "apx" },
    hosts: k?.hosts ?? [],
    ownerHost: false,
    runsCode: k?.runs_code ?? Boolean(c.needs?.includes("code")),
    connection: c.listing?.connection,
    keys: k?.key_labels?.map((s) => settingText(s, lang).label) ?? k?.keys ?? [],
    servers: k?.servers ?? (c.brings?.includes("tools") ? 1 : 0),
    tools: listed(c.listing, lang),
    skills: k?.skills,
    skillCount: k?.skills?.length ?? (c.brings?.includes("skills") ? 1 : 0),
    agents: k?.agents ?? [],
    routines: k?.routines ?? [],
    companion: k?.companion,
    apps: c.brings?.includes("apps") ? 1 : 0,
    requirements: copy?.requirements ?? [],
    files: c.provenance === "official" ? "official" : c.catalog ? "third" : undefined,
    hash: k?.hash,
    listing: c.listing,
    entry: c,
  };
}

/** A server the owner gives by its address: theirs, reached there, its tools known once it answers. */
export function aboutAddress(url: string, name: string, tools?: string[]): About {
  const host = URL.parse(url)?.host ?? url;
  return {
    id: name,
    name,
    tagline: undefined,
    label: "own",
    origin: { kind: "url", host },
    hosts: [host],
    ownerHost: false,
    runsCode: false,
    keys: [],
    servers: 1,
    tools: tools?.length ? { names: tools, real: true } : undefined,
    skillCount: 0,
    agents: [],
    routines: [],
    apps: 0,
    requirements: [],
  };
}

/** "the folder ~/work/crm", "APX's catalog": where it comes from, in a few words. */
export function originText(o: Origin, t: T): string {
  if (o.kind === "apx") return t("box.from.apx");
  if (o.kind === "catalog") return t("box.from.catalog", { name: o.name });
  if (o.kind === "file") return t("box.from.file", { name: o.name });
  if (o.kind === "url") return t("box.from.url", { host: o.host });
  return t("box.from.folder", { path: o.path });
}

/** How it connects, in a few words; nothing when APX does not know. */
export function connectText(a: About, t: T): string | undefined {
  if (a.companion || a.connection === "pairing") return t("box.how.pair");
  if (a.connection === "oauth") return t("box.how.signIn", { name: a.name });
  if (a.keys.length) return a.keys.join(", ");
  if (a.connection === "key") return t("box.how.key");
  if (a.connection === "none" || (a.servers > 0 && !a.runsCode)) return t("box.how.nothing");
  return undefined;
}

/** The first few tool names and how many more: "list customers, get a payment and 3 more". */
export function toolsLine(names: string[], t: T, max = 8): string {
  const words = names.map(toolWords);
  if (words.length <= max) return listText(words, t);
  return t("box.andMore", { list: words.slice(0, max).join(", "), n: words.length - max });
}

/** "a, b and c" in the owner's language. */
export function listText(words: string[], t: T): string {
  if (words.length < 2) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${t("mkt.and")} ${words.at(-1)}`;
}

/** Why a package was refused, from the error's detail; a refusal APX did not explain is `other`. */
export function refusalOf(e: unknown): ExtensionRefusal | undefined {
  const d = (e as { detail?: unknown } | undefined)?.detail as Partial<ExtensionRefusal> | undefined;
  return d && typeof d.reason === "string" ? (d as ExtensionRefusal) : undefined;
}
