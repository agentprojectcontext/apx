// Tiny i18n: English keys and text, translations per language, the language chosen per device. Only the language
// on screen is loaded (messages.ts); switching loads the other one, then the panel re-renders in it.
import { useCallback, useSyncExternalStore } from "react";
import { prefs, usePrefs } from "../data/prefs.ts";
import { type Language, LOCALES, loadMessages, type MessageKey, type Messages } from "./messages.ts";

export type { Language, MessageKey } from "./messages.ts";
export { isLanguage, LANGUAGE_NAMES, LANGUAGES, LOCALES } from "./messages.ts";

/** Values for `{name}` placeholders. */
export type Vars = Record<string, string | number>;
export type T = (key: MessageKey, vars?: Vars) => string;

let shown: { lang: Language; messages: Messages } | undefined;
const listeners = new Set<() => void>();
let wanted: Language | undefined;

async function show(lang: Language): Promise<void> {
  wanted = lang;
  const messages = await loadMessages(lang);
  if (wanted !== lang) return;
  shown = { lang, messages };
  for (const l of listeners) l();
}

/** Loads the chosen language before the first render, then follows the preference. */
export async function startI18n(): Promise<void> {
  await show(prefs.get().language);
  let last = prefs.get().language;
  prefs.subscribe(() => {
    const next = prefs.get().language;
    if (next === last) return;
    last = next;
    void show(next);
  });
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}

/** Whether a string from the core (e.g. a notice code) has a translation key here. */
export function isKey(key: string): key is MessageKey {
  return shown != null && Object.hasOwn(shown.messages, key);
}

function useShown(): typeof shown {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => shown,
  );
}

/** Translator for components; re-renders when the language on screen changes. */
export function useT(): T {
  const cur = useShown();
  return useCallback((key, vars) => fill(cur?.messages[key] ?? key, vars), [cur]);
}

/** The language on screen (it follows the preference once its texts are loaded). */
export function useLanguage(): Language {
  const pref = usePrefs((p) => p.language);
  return useShown()?.lang ?? pref;
}

/** Translator outside React (data actions, formatters): reads the language on screen. */
export function t(key: MessageKey, vars?: Vars): string {
  return fill(shown?.messages[key] ?? key, vars);
}

/** Intl locale of the language on screen ("en-US", "es-AR"). */
export function currentLocale(): string {
  return LOCALES[shown?.lang ?? prefs.get().language];
}
