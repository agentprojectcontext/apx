// Tiny i18n: English keys and text, translations per language, the language chosen per device.
import { usePrefs } from "../data/prefs.ts";
import { en, LANGUAGES, type Language, type MessageKey } from "./messages.ts";

export type { Language, MessageKey } from "./messages.ts";

export function translate(lang: Language, key: MessageKey): string {
  return LANGUAGES[lang][key] ?? en[key];
}

/** Whether a string from the core (e.g. a notice code) has a translation key here. */
export function isKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

export function useT(): (key: MessageKey) => string {
  const lang = usePrefs((p) => p.language);
  return (key) => translate(lang, key);
}

export function defaultLanguage(): Language {
  const nav = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  return nav.startsWith("es") ? "es" : "en";
}
