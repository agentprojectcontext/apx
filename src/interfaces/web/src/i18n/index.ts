// Tiny in-house i18n. No runtime library — keys are dotted paths into
// `es.ts`. The lookup is dynamic (so loading another locale later is just
// swapping the dictionary) but the bundle ships only one language at a
// time. Unknown keys log a warning and return the key itself so missing
// strings surface visually in dev.
import { es, type EsStrings } from "./es";
import { STORAGE } from "../constants";

type DeepKeys<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends object
    ? DeepKeys<T[K], P extends "" ? K : `${P}.${K}`>
    : P extends "" ? K : `${P}.${K}`;
}[keyof T & string];

export type TKey = DeepKeys<EsStrings>;

const dictionaries = { es } as const;
type Locale = keyof typeof dictionaries;

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE.language);
    if (saved && saved in dictionaries) return saved as Locale;
  } catch { /* ignore */ }
  return "es";
}

let activeLocale: Locale = readLocale();

export function setLocale(l: Locale) {
  activeLocale = l;
  try { localStorage.setItem(STORAGE.language, l); } catch { /* quota */ }
}

export function getLocale(): Locale { return activeLocale; }

function lookup(key: string): string | undefined {
  const dict = dictionaries[activeLocale] as unknown as Record<string, unknown>;
  const parts = key.split(".");
  let cur: any = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

function format(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function t(key: TKey, vars?: Record<string, string | number>): string {
  const found = lookup(key as string);
  if (found === undefined) {
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key as string;
  }
  return format(found, vars);
}
