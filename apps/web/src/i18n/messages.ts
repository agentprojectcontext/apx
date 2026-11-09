// Languages the panel speaks. English is the source; each language is its own chunk, loaded when chosen, so the
// panel downloads and keeps only the one on screen. Every language holds every key (messages.test.ts).
import type { MessageKey } from "./en.ts";

export type { MessageKey };

export type Language = "en" | "es";
export type Messages = Partial<Record<MessageKey, string>>;

export const LANGUAGES: readonly Language[] = ["en", "es"];

const LOADERS: Record<Language, () => Promise<Messages>> = {
  en: () => import("./en.ts").then((m) => m.en),
  es: () => import("./es.ts").then((m) => m.es),
};

export function loadMessages(lang: Language): Promise<Messages> {
  return LOADERS[lang]();
}

/** Strings only one late screen shows: loaded with it (index.ts usePack), never with the first screen. */
const PACKS = {
  activityReview: {
    en: () => import("./activity-review-en.ts").then((m) => m.enActivityReview),
    es: () => import("./activity-review-es.ts").then((m) => m.esActivityReview),
  },
  approvals: {
    en: () => import("./approvals-en.ts").then((m) => m.enApprovals),
    es: () => import("./approvals-es.ts").then((m) => m.esApprovals),
  },
  flow: {
    en: () => import("./flow-en.ts").then((m) => m.enFlow),
    es: () => import("./flow-es.ts").then((m) => m.esFlow),
  },
  ingress: {
    en: () => import("./ingress-en.ts").then((m) => m.enIngress),
    es: () => import("./ingress-es.ts").then((m) => m.esIngress),
  },
  secretary: {
    en: () => import("./secretary-en.ts").then((m) => m.enSecretary),
    es: () => import("./secretary-es.ts").then((m) => m.esSecretary),
  },
  threads: {
    en: () => import("./thread-dialogs-en.ts").then((m) => m.enThreadDialogs),
    es: () => import("./thread-dialogs-es.ts").then((m) => m.esThreadDialogs),
  },
  signatures: {
    en: () => import("./en-email-signatures.ts").then((m) => m.enEmailSignatures),
    es: () => import("./es-email-signatures.ts").then((m) => m.esEmailSignatures),
  },
  browserEdit: {
    en: () => import("./browser-edit-en.ts").then((m) => m.enBrowserEdit),
    es: () => import("./browser-edit-es.ts").then((m) => m.esBrowserEdit),
  },
  computer: {
    en: () => import("./computer-en.ts").then((m) => m.enComputer),
    es: () => import("./computer-es.ts").then((m) => m.esComputer),
  },
  received: {
    en: () => import("./received-en.ts").then((m) => m.enReceived),
    es: () => import("./received-es.ts").then((m) => m.esReceived),
  },
  move: {
    en: () => import("./move-en.ts").then((m) => m.enMove),
    es: () => import("./move-es.ts").then((m) => m.esMove),
  },
  storage: {
    en: () => import("./storage-en.ts").then((m) => m.enStorage),
    es: () => import("./storage-es.ts").then((m) => m.esStorage),
  },
  signIn: {
    en: () => import("./signin-en.ts").then((m) => m.enSignIn),
    es: () => import("./signin-es.ts").then((m) => m.esSignIn),
  },
  // The first run, the connection and pairing screens and About: every screen under setup/.
  setup: {
    en: () => import("./en-setup.ts").then((m) => m.enSetup),
    es: () => import("./es-setup.ts").then((m) => m.esSetup),
  },
  // An agent's editor, a project's team and org chart, and the agents' settings.
  team: {
    en: () => import("./en-team.ts").then((m) => m.enTeam),
    es: () => import("./es-team.ts").then((m) => m.esTeam),
  },
  // Skills, MCP, integrations, variables and extensions: the Resources screen and what opens from it.
  resources: {
    en: () => import("./en-resources.ts").then((m) => m.enResources),
    es: () => import("./es-resources.ts").then((m) => m.esResources),
  },
  usage: {
    en: () => import("./sysusage-en.ts").then((m) => m.enSysUsage),
    es: () => import("./sysusage-es.ts").then((m) => m.esSysUsage),
  },
} satisfies Record<string, Record<Language, () => Promise<Messages>>>;
export type Pack = keyof typeof PACKS;

export function loadPack(pack: Pack, lang: Language): Promise<Messages> {
  return PACKS[pack][lang]();
}

/** Each language named in itself, for the pickers. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

/** Intl locale for dates and numbers. */
export const LOCALES: Record<Language, string> = { en: "en-US", es: "es-AR" };

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}

export function defaultLanguage(): Language {
  const nav = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  return nav.startsWith("es") ? "es" : "en";
}
