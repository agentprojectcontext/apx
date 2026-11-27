import type { ExtensionConnector, McpServerStatus } from "@apx/protocol";
import type { Item } from "../resources/extensionItems.ts";
import { type Auth, authOf, listingIn } from "./itemText.ts";
import { settingText } from "./settingText.ts";

// What an extension brings, the same before it is added (its catalog entry's contents) and after (its manifest and
// its servers' state): each connector with its address, sign-in and tools; its skills and agents with their lines;
// routines, widgets, a device's app; and the keys and settings it will ask for. A fact APX does not know is left out.

export type Connector = {
  key: string;
  name: string;
  /** One of several, by its server's name: its app's mark when APX has one. */
  mark?: string | undefined;
  /** The address it reaches: its own, or the remote one its program bridges to. */
  address?: string | undefined;
  /** It reaches an address the owner types in its settings. */
  ownerAddress: boolean;
  /** A program that runs on this computer. */
  runsHere: boolean;
  auth?: Auth | undefined;
  /** Named by its listing before it ran (`real: false`), or by its server once it started. */
  tools?: { names: string[]; real: boolean } | undefined;
  server?: McpServerStatus | undefined;
};

type Named = { name: string; line?: string | undefined };

export type Brings = {
  connectors: Connector[];
  /** Its skills by name; absent while APX does not know them (an entry whose files were not read). */
  skills?: Named[] | undefined;
  agents: Named[];
  routines: string[];
  device?: { name: string; platform: string } | undefined;
  widgets: number;
  /** The keys it will ask for, by their labels. */
  keys: string[];
  /** The settings it needs before it works, by their labels. */
  settings: string[];
  /** Its files were read (or it is added): what it brings is known, not guessed from the catalog's words. */
  known: boolean;
};

/** A skill's line as the page shows it: its first sentence, or its start cut at a word when that runs long. */
export function shortLine(text: string | undefined, max = 180): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const first = /^(.+?[.!?])(\s|$)/.exec(t)?.[1] ?? t;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : max).replace(/[\s,;:–-]+$/, "")}…`;
}

const named = (names: string[], lines: Record<string, string> | undefined): Named[] =>
  names.map((name) => ({ name, line: shortLine(lines?.[name]) }));

/** A server's name as a label: `microsoft_365` → "Microsoft 365". */
const serverLabel = (name: string) => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const listedTools = (i: Item, lang: string) => {
  const names = listingIn(i.listing, lang)?.tools.map((x) => x.name) ?? [];
  return names.length ? { names, real: false } : undefined;
};

/** A server's tools once it answered, else the ones its listing names. */
const toolsOf = (s: McpServerStatus | undefined, listed: Connector["tools"]) =>
  s?.tool_names.length ? { names: s.tool_names, real: true } : listed;

/** An account's or a plain server's address: its own for one reached over the network; none for a program. */
const serverAddress = (s: McpServerStatus | undefined) =>
  s?.transport === "http" ? (s.definition?.url ?? s.target) : undefined;

/** One connector; `own`: the server's own name when it is one of several, else it reads as the extension's. */
function connector(
  i: Item,
  key: string,
  own: string | undefined,
  c: ExtensionConnector | undefined,
  server: McpServerStatus | undefined,
  listed: Connector["tools"],
): Connector {
  return {
    key,
    name: own ? serverLabel(own) : i.name,
    mark: own?.toLowerCase().replace(/_/g, "-"),
    address: c?.url ?? serverAddress(server),
    ownerAddress: Boolean(c?.owner_url),
    runsHere: c ? c.runs_here : server?.transport === "stdio",
    auth: authOf(i),
    tools: toolsOf(server, listed),
    server,
  };
}

export function bringsOf(i: Item, servers: McpServerStatus[], lang: string): Brings {
  const listed = listedTools(i, lang);
  const e = i.ext;
  if (e) {
    const own = (n: string) => servers.find((s) => s.scope === "global" && s.name === n);
    const many = e.mcp.length > 1;
    return {
      // One server named after the extension reads as its own connector; several, by their own names.
      connectors: e.mcp.map((n, x) =>
        connector(
          i,
          n,
          many ? n.replace(`${e.id}-`, "") : undefined,
          e.connectors?.[x],
          own(n),
          many ? undefined : listed,
        ),
      ),
      skills: named(e.skills, e.skill_lines),
      agents: e.agents.map((a) => ({ name: a.name, line: a.description || undefined })),
      routines: e.routines.map((r) => r.name),
      device: e.companion ? { name: e.companion.name, platform: e.companion.platform } : undefined,
      widgets: e.apps.length,
      keys: [...e.secrets, ...e.settings.filter((s) => s.sensitive)].map((s) => settingText(s, lang).label),
      settings: e.settings
        .filter((s) => s.required && !s.sensitive && !s.generate && s.default === undefined)
        .map((s) => settingText(s, lang).label),
      known: true,
    };
  }
  const k = i.entry?.contents;
  if (k) {
    const list = k.connectors ?? Array.from({ length: k.servers }, (_, n) => ({ name: String(n), runs_here: false }));
    const many = list.length > 1;
    return {
      connectors: list.map((c, n) =>
        connector(
          i,
          `${n}:${c.name}`,
          many ? c.name : undefined,
          k.connectors ? c : undefined,
          undefined,
          many ? undefined : listed,
        ),
      ),
      skills: k.skills ? named(k.skills, k.skill_lines) : undefined,
      agents: named(k.agents, k.agent_lines),
      routines: k.routines,
      device: k.companion,
      widgets: k.apps ?? (i.brings.includes("apps") ? 1 : 0),
      keys: k.key_labels?.map((s) => settingText(s, lang).label) ?? k.keys,
      settings: k.setting_labels?.map((s) => settingText(s, lang).label) ?? k.settings ?? [],
      known: true,
    };
  }
  // An account APX ships, a server the owner added, or an entry whose files APX has not read yet.
  const connects = Boolean(
    i.integration || i.server || (!i.channel && !i.builtin && i.brings.some((b) => b === "tools" || b === "accounts")),
  );
  const offered = i.state === "available" && !i.integration && !i.channel && !i.builtin;
  return {
    connectors: connects ? [connector(i, "conn", undefined, undefined, i.server, listed)] : [],
    skills: offered ? undefined : [],
    agents: [],
    routines: [],
    widgets: 0,
    keys: [],
    settings: [],
    known: !offered,
  };
}

/** What a list row marks with an icon: how many of each, a count left out when APX does not know it. */
export type Count = { kind: "connector" | "skills" | "agents" | "device" | "widgets"; n?: number | undefined };

export function countsOf(i: Item, lang: string): Count[] {
  if (i.channel || i.builtin || i.integration?.own) return [];
  const b = bringsOf(i, [], lang);
  const out: Count[] = [];
  if (b.connectors.length) out.push({ kind: "connector", n: b.connectors.length });
  if (b.skills?.length) out.push({ kind: "skills", n: b.skills.length });
  else if (!b.skills && i.brings.includes("skills")) out.push({ kind: "skills" });
  if (b.agents.length) out.push({ kind: "agents", n: b.agents.length });
  else if (!b.known && i.brings.includes("agents")) out.push({ kind: "agents" });
  if (b.device || (!b.known && i.brings.includes("devices"))) out.push({ kind: "device" });
  if (b.widgets) out.push({ kind: "widgets", n: b.widgets });
  return out;
}
