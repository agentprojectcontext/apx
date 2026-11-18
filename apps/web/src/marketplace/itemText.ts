import type { ExtensionListing, McpServerStatus } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";

// What the Marketplace says about an item, in the owner's words, from what APX knows of it (its manifest, its listing,
// its servers): what it brings, its one next step, why it waits, what it may reach and how it signs in. A fact APX
// does not know is left out, never guessed.

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Its one next step, the only button its row and its page show. */
export type Step =
  | "add"
  | "connect"
  | "pair"
  | "turn-on"
  | "keys"
  | "settings"
  | "sign-in"
  | "fix"
  | "review"
  | "channel"
  | "browser"
  | "coming"
  | "done";

export function nextStep(i: Item): Step {
  if (i.builtin === "browser") return "browser";
  if (i.channel) return i.state === "available" ? "connect" : "channel";
  if (i.state === "coming") return "coming";
  if (i.state === "available") return i.integration || i.origin === "included" ? "connect" : "add";
  if (i.integration) return i.attention === "sign-in" ? "sign-in" : i.attention ? "fix" : "done";
  if (i.server && !i.ext) {
    if (i.state === "off") return "turn-on";
    return i.attention === "sign-in" ? "sign-in" : i.attention ? "fix" : "done";
  }
  const e = i.ext;
  if (!e) return "done";
  if (i.state === "off") return i.attention === "update-waits" ? "review" : e.companion ? "pair" : "connect";
  if (i.attention === "keys") return "keys";
  if (i.attention === "settings") return "settings";
  if (i.attention) return "fix";
  // APX cannot tell whether the app on the device is paired: pairing stays at hand.
  return e.companion ? "pair" : "done";
}

const STEP_LABEL: Record<Step, MessageKey> = {
  add: "mkt.step.add",
  connect: "mkt.step.connect",
  pair: "mkt.step.pair",
  "turn-on": "mkt.step.connect",
  keys: "mkt.step.connect",
  settings: "mkt.step.settings",
  "sign-in": "mkt.step.signIn",
  fix: "mkt.step.fix",
  review: "mkt.step.review",
  channel: "mkt.step.channel",
  browser: "mkt.step.browser",
  coming: "mkt.step.coming",
  done: "mkt.step.connected",
};

/** Its working state once done: connected when it signs in to something, else simply on. */
export function stepLabel(i: Item, step: Step, t: T): string {
  if (step === "done") return t(signsIn(i) ? "mkt.step.connected" : "mkt.step.on");
  return t(STEP_LABEL[step]);
}

/** It connects to an account (keys, a sign-in): "Connected" fits it; otherwise it is just on. */
const signsIn = (i: Item) =>
  Boolean(i.integration || i.channel || i.ext?.secrets.length || i.brings.includes("accounts") || i.server);

/** Why one of the owner's own waits on them, in a few words; nothing when it does not. */
export function waitReason(i: Item, t: T): string | undefined {
  if (i.state === "available" || i.state === "coming") return undefined;
  if (i.update && i.state === "on") return t("mkt.why.update", { version: i.update });
  if (i.state === "off") return t(i.attention === "update-waits" ? "mkt.why.updateWaits" : "mkt.why.off");
  if (i.attention === "keys") return t("mkt.why.keys");
  if (i.attention === "settings") return t("mkt.why.settings");
  if (i.attention === "sign-in") return t("mkt.why.signIn");
  if (i.attention) return t("mkt.why.error");
  return undefined;
}

/** "Connection and skills": what it brings, as one phrase. */
export function bringsText(i: Item, t: T): string {
  const e = i.ext;
  const parts: MessageKey[] = [];
  if (i.brings.includes("accounts") || i.brings.includes("tools") || e?.mcp.length || i.server)
    parts.push("mkt.part.connection");
  if (i.brings.includes("skills") || e?.skills.length) parts.push("mkt.part.skills");
  if (i.brings.includes("agents") || e?.agents.length) parts.push("mkt.part.agents");
  if (e?.routines.length) parts.push("mkt.part.routines");
  if (i.brings.includes("devices") || e?.companion) parts.push("mkt.part.device");
  if (i.brings.includes("apps") || e?.apps.length) parts.push("mkt.part.apps");
  const words = parts.map((k) => t(k));
  if (!words.length) return "";
  const last = words.pop() as string;
  const phrase = words.length ? `${words.join(", ")} ${t("mkt.and")} ${last}` : last;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** "From APX", "Added by you": who it comes from; nothing when no one says. */
export function fromText(i: Item, t: T): string | undefined {
  if (i.label === "own") return t("mkt.from.you");
  return i.publisher ? t("mkt.from", { name: i.publisher }) : undefined;
}

const host = (u: string) => URL.parse(u)?.host ?? u;

/** Where a server talks to: its address's host, or this computer for one that runs a command. */
export function serverPlace(s: McpServerStatus, t: T): string {
  return s.transport === "http" ? host(s.definition?.url ?? s.target) : t("mkt.place.here");
}

/** How it signs in, as its listing or its connection says. */
export function authText(i: Item, t: T): string | undefined {
  const via = i.connection ?? i.listing?.connection;
  if (i.integration) {
    if (i.integration.oauth) return t("mkt.auth.signIn");
    if (i.integration.fields.length) return t("mkt.auth.key");
    // With no keys, its server says it: one reached at its address asks for nothing, one run here signs in in the
    // browser. Not connected yet, APX does not know which.
    if (!i.server) return undefined;
    return i.server.transport === "http" ? t("mkt.auth.none") : t("mkt.auth.signIn");
  }
  if (i.ext?.companion || via === "pairing") return t("mkt.auth.pairing");
  if (via === "oauth" || i.server?.status === "needs-sign-in") return t("mkt.auth.signIn");
  if (via === "key" || i.ext?.secrets.length) return t("mkt.auth.key");
  if (via === "none" || via === "local") return t("mkt.auth.none");
  return undefined;
}

/** What it may reach and run, one line each: the hosts it sends data to, code on this computer, what its plugin sees. */
export function accessLines(i: Item, t: T): string[] {
  const e = i.ext;
  const out: string[] = [];
  const hosts = new Set<string>(e?.hosts ?? []);
  for (const s of i.server ? [i.server] : []) if (s.transport === "http") hosts.add(serverPlace(s, t));
  if (hosts.size) out.push(t("mkt.access.hosts", { hosts: [...hosts].join(", ") }));
  if (e?.owner_host) out.push(t("mkt.access.yourHost"));
  if (e?.runs_code || i.server?.transport === "stdio") out.push(t("mkt.access.code"));
  if (e?.plugin?.context) out.push(t("mkt.access.context"));
  if (e?.plugin?.observe.length) out.push(t("mkt.access.observe", { events: e.plugin.observe.join(", ") }));
  if (e?.plugin?.local_network) out.push(t("mkt.access.localNetwork"));
  return out;
}

/** "18 nov 2026" in the owner's language. */
export const dayText = (iso: string | undefined, lang: string) => {
  const d = iso ? new Date(iso) : undefined;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" })
    : undefined;
};

/** The few just published, newest first: none while the whole catalog is new (then nothing stands out). */
export function newest(items: Item[], now: number, max = 6): Item[] {
  const MONTH = 30 * 24 * 3600_000;
  const offered = items.filter((i) => i.published);
  const recent = offered.filter((i) => now - Date.parse(i.published as string) < MONTH);
  if (!recent.length || recent.length > offered.length / 2) return [];
  return recent.sort((a, b) => Date.parse(b.published as string) - Date.parse(a.published as string)).slice(0, max);
}

/** Its listing in the language on screen (the Spanish copy keeps what it does not translate). */
export function listingIn(l: ExtensionListing | undefined, lang: string): Omit<ExtensionListing, "es"> | undefined {
  if (!l) return undefined;
  if (lang !== "es" || !l.es) return l;
  return { ...l, ...l.es, tagline: l.es.tagline ?? l.tagline, description: l.es.description ?? l.description };
}

/** "https://mcp.acme.example/mcp" → "acme": the host's name without its mcp./www. prefix, free among the owner's. */
export function nameFor(url: string, taken: string[]): string {
  const host = URL.parse(url)?.hostname ?? "";
  const parts = host.split(".").filter((p) => p && !["mcp", "www", "api"].includes(p));
  const base =
    (parts[0] ?? "server")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/^[-_]+/, "")
      .slice(0, 36) || "server";
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}
