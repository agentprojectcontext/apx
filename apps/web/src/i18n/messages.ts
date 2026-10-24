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
  computer: {
    en: () => import("./computer-en.ts").then((m) => m.enComputer),
    es: () => import("./computer-es.ts").then((m) => m.esComputer),
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
