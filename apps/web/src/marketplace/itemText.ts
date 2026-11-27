import type { ExtensionInfo, ExtensionListing, ExtensionPower, McpServerStatus } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";
import { type Item, kindOf } from "../resources/extensionItems.ts";

export function connectionUpdateText(
  update: NonNullable<ExtensionInfo["update"]>,
  settings: Pick<ExtensionInfo["settings"][number], "name" | "boundTo">[],
  label: (power: ExtensionPower) => string,
  display?: {
    singleConnection?: { extensionId: string; registeredId: string; name: string } | undefined;
    addedLabel?: typeof label;
  },
) {
  const bound = update.adds.filter(
    (power) =>
      power.kind === "secret" && settings.some((setting) => setting.name === power.name && setting.boundTo?.length),
  );
  const oldSecrets = update.removes.filter((power) => power.kind === "secret");
  const reconnect = bound.length === 1 && oldSecrets.length === 1 && !update.keeps_on;
  const changedNames = new Set(
    update.adds
      .filter(
        (power) => power.kind === "mcp" && update.removes.some((old) => old.kind === "mcp" && old.name === power.name),
      )
      .map((power) => power.name),
  );
  const changed = (power: ExtensionPower) => power.kind === "mcp" && changedNames.has(power.name);
  const single = display?.singleConnection;
  return {
    adds: update.adds.filter((power) => !changed(power)).map(display?.addedLabel ?? label),
    drops: update.removes.filter((power) => !changed(power)).map(label),
    changed: [...changedNames].map((name) =>
      single && single.registeredId === `${single.extensionId}-${name}` ? single.name : name,
    ),
    reconnect,
  };
}

// What the Marketplace says about an item, in the owner's words, from what APX knows of it (its manifest, its listing,
// its servers): what it brings, its one next step, why it waits, what it may reach and how it signs in. A fact APX
// does not know is left out, never guessed.

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

type SettingCopy = { label: string; description?: string | undefined };

export function settingCopyIn(
  setting: SettingCopy & { locales?: { es?: Partial<SettingCopy> | undefined } | undefined },
  lang: string,
): SettingCopy {
  const copy = lang === "es" ? setting.locales?.es : undefined;
  return { label: copy?.label ?? setting.label, description: copy?.description ?? setting.description };
}

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
  if (i.attention === "update-waits") return "review";
  if (i.state === "off") return e.companion ? "pair" : "connect";
  if (i.attention === "keys") return "keys";
  if (i.attention === "settings") return "settings";
  if (i.attention === "sign-in") return "sign-in";
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
  Boolean(
    i.integration ||
      i.channel ||
      i.ext?.secrets.length ||
      i.ext?.mcp.length ||
      i.brings.includes("accounts") ||
      i.server,
  );

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

/** "Connector", "Native integration": what it is, as its row says (DECISIONS.md#d-250). */
export function kindText(i: Item, t: T): string {
  return t(`mkt.kind.${kindOf(i)}` as MessageKey);
}

/** Authorship is independent of APX's review, the service's brand and who added the package. */
export function fromText(i: Pick<Item, "label" | "publisher" | "github">, t: T): string {
  if (i.publisher) return t("mkt.from", { name: i.publisher });
  if (i.github) return t("mkt.from.github", { name: i.github });
  return t(i.label === "own" ? "mkt.from.you" : "mkt.creatorUnknown");
}

const host = (u: string) => URL.parse(u)?.host ?? u;

/** Where a server talks to: its address's host, or this computer for one that runs a command. */
function serverPlace(s: McpServerStatus, t: T): string {
  return s.transport === "http" ? host(s.definition?.url ?? s.target) : t("mkt.place.here");
}

/** How it signs in: on the service's page, with a key of the owner's, with a code a device shows, or not at all. */
export type Auth = "signIn" | "key" | "pairing" | "none";

/** How it signs in, as its listing, its keys or its server say; nothing when APX does not know. */
export function authOf(i: Item): Auth | undefined {
  const via = i.connection ?? i.listing?.connection;
  if (i.integration) {
    if (i.integration.oauth) return "signIn";
    if (i.integration.fields.length) return "key";
    // With no keys, its server says it: one reached at its address asks for nothing, one run here signs in in the
    // browser. Not connected yet, APX does not know which.
    if (!i.server) return undefined;
    return i.server.transport === "http" ? "none" : "signIn";
  }
  if (i.ext?.companion || i.entry?.contents?.companion || via === "pairing") return "pairing";
  if (via === "oauth" || i.server?.status === "needs-sign-in") return "signIn";
  if (via === "key" || i.ext?.secrets.length || i.entry?.contents?.keys.length) return "key";
  if (via === "none" || via === "local") return "none";
  return undefined;
}

export const AUTH_TEXT: Record<Auth, MessageKey> = {
  signIn: "mkt.auth.signIn",
  key: "mkt.auth.key",
  pairing: "mkt.auth.pairing",
  none: "mkt.auth.none",
};

/** How it signs in, in the owner's words. */
export function authText(i: Item, t: T): string | undefined {
  const a = authOf(i);
  return a ? t(AUTH_TEXT[a]) : undefined;
}

/** What it may reach and run, one line each: the hosts it sends data to, code on this computer, what its plugin sees. */
export function accessLines(i: Item, t: T): string[] {
  const e = i.ext;
  const k = i.entry?.contents;
  const out: string[] = [];
  const hosts = new Set<string>(e?.hosts ?? k?.hosts ?? []);
  for (const s of i.server ? [i.server] : []) if (s.transport === "http") hosts.add(serverPlace(s, t));
  if (hosts.size) out.push(t("mkt.access.hosts", { hosts: [...hosts].join(", ") }));
  if (e?.owner_host || k?.connectors?.some((c) => c.owner_url)) out.push(t("mkt.access.yourHost"));
  if (e?.runs_code || (!e && k?.runs_code) || i.server?.transport === "stdio") out.push(t("mkt.access.code"));
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
