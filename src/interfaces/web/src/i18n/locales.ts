// Locale picker data — language AND region, which is not the same question the
// language picker answers.
//
// `es` is neutral Spanish; `es-AR` is the one that says "vos". The agent reads
// the most specific tag it has (core/agent/author-line.js takes user.locale
// before user.language), so this is the field that decides whether a reply
// sounds like Buenos Aires or like a manual.
//
// Names come from Intl.DisplayNames in the active UI locale, so the list reads
// "Español (Argentina)" in Spanish and "Spanish (Argentina)" in English with no
// name table to maintain. The raw tag is kept in the label because the tag is
// what gets stored — and because typing "es-AR" is how anyone who knows the
// code will look for it.
import { getLocale } from "./index";
import type { SearchOption } from "../components/SearchSelect";

// BCP-47 tags for the languages the identity picker offers. Regions are the
// ones with a real written difference, not every country that speaks it.
export const LOCALE_TAGS = [
  "es-AR", "es-BO", "es-CL", "es-CO", "es-CR", "es-DO", "es-EC", "es-ES",
  "es-GT", "es-HN", "es-MX", "es-NI", "es-PA", "es-PE", "es-PR", "es-PY",
  "es-SV", "es-US", "es-UY", "es-VE",
  "en-US", "en-GB", "en-AU", "en-CA", "en-IE", "en-IN", "en-NZ", "en-ZA",
  "pt-BR", "pt-PT",
  "fr-FR", "fr-CA", "fr-BE", "fr-CH",
  "it-IT", "it-CH",
  "de-DE", "de-AT", "de-CH",
  "nl-NL", "nl-BE",
  "ca-ES", "gl-ES", "eu-ES",
  "sv-SE", "nb-NO", "da-DK", "fi-FI", "is-IS",
  "pl-PL", "cs-CZ", "sk-SK", "sl-SI", "hr-HR", "sr-RS", "uk-UA", "ru-RU",
  "bg-BG", "ro-RO", "hu-HU", "el-GR",
  "tr-TR", "ar-SA", "ar-EG", "he-IL", "fa-IR", "hi-IN", "bn-BD", "ta-IN",
  "ur-PK",
  "id-ID", "ms-MY", "vi-VN", "th-TH", "ko-KR", "ja-JP",
  "zh-CN", "zh-TW", "zh-HK",
] as const;

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

let cached: { locale: string; options: SearchOption[] } | null = null;

/** Every offered locale as `es-AR · Español (Argentina)`, sorted by name. */
export function localeOptions(): SearchOption[] {
  const locale = getLocale();
  if (cached?.locale === locale) return cached.options;
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    display = null; // ancient runtime — the tag alone still identifies it
  }
  const options = LOCALE_TAGS.map((tag) => {
    const name = display?.of(tag);
    return { value: tag, label: name && name !== tag ? `${tag} · ${capitalize(name)}` : tag };
  }).sort((a, b) => a.label.localeCompare(b.label, locale));
  cached = { locale, options };
  return options;
}

/** The browser's own locale (es-AR on this machine), for the empty state. */
export function detectLocale(): string {
  try { return new Intl.NumberFormat().resolvedOptions().locale || "en-US"; }
  catch { return "en-US"; }
}
