// Tiny i18n: English keys and text, translations per language, the language chosen per device.
import { useCallback } from "react";
import { prefs, usePrefs } from "../data/prefs.ts";
import { en, LANGUAGES, type Language, LOCALES, type MessageKey } from "./messages.ts";

export type { Language, MessageKey } from "./messages.ts";
export { isLanguage, LANGUAGE_NAMES, LANGUAGES, LOCALES } from "./messages.ts";

/** Values for `{name}` placeholders. */
export type Vars = Record<string, string | number>;
export type T = (key: MessageKey, vars?: Vars) => string;

export function translate(lang: Language, key: MessageKey, vars?: Vars): string {
  const text: string = LANGUAGES[lang][key] ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}

/** Whether a string from the core (e.g. a notice code) has a translation key here. */
export function isKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** Translator for components; re-renders when the language changes. */
export function useT(): T {
  const lang = usePrefs((p) => p.language);
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

export function useLanguage(): Language {
  return usePrefs((p) => p.language);
}

/** Translator outside React (data actions, formatters): reads the current language. */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(prefs.get().language, key, vars);
}

/** Intl locale of the current language ("en-US", "es-AR"). */
export function currentLocale(): string {
  return LOCALES[prefs.get().language];
}
