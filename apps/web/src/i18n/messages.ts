// Languages the panel speaks. English is the source; a missing translation falls back to it key by key.
import { en, type MessageKey } from "./en.ts";
import { es } from "./es.ts";

export { en, type MessageKey };

export const LANGUAGES = { en, es } as const;
export type Language = keyof typeof LANGUAGES;

/** Each language named in itself, for the pickers. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

/** Intl locale for dates and numbers. */
export const LOCALES: Record<Language, string> = { en: "en-US", es: "es-AR" };

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && Object.hasOwn(LANGUAGES, v);
}

export function defaultLanguage(): Language {
  const nav = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  return nav.startsWith("es") ? "es" : "en";
}
