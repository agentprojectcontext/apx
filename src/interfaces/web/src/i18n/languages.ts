// Localized language picker for the super-agent's preferred language.
//
// The list is ISO 639-1 codes; the human-readable name is produced at render
// time by the native Intl.DisplayNames API in the active UI locale (es/en).
// That keeps the dropdown showing "Español", "Inglés"… (or "Spanish",
// "English"…) without us hand-maintaining a name table per language.
import { getLocale } from "./index";

// ISO 639-1 codes offered as the identity's preferred language. This only
// drives the agent's identity — it is NOT the app UI language (that stays es/en).
export const IDENTITY_LANG_CODES = [
  "es", "en", "pt", "fr", "it", "de", "ca", "gl", "eu",
  "nl", "sv", "no", "da", "fi", "is",
  "pl", "cs", "sk", "sl", "hr", "sr", "uk", "ru", "bg", "ro", "hu", "el",
  "tr", "ar", "he", "fa", "hi", "bn", "ta", "ur",
  "id", "ms", "vi", "th", "ko", "ja", "zh",
] as const;

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

// Builds { value, label } options with names localized to the active UI locale,
// sorted alphabetically by that localized name.
export function languageOptions(): { value: string; label: string }[] {
  const locale = getLocale();
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    display = null; // ancient runtime — fall back to raw codes
  }
  return IDENTITY_LANG_CODES.map((code) => {
    const name = display?.of(code);
    return { value: code, label: name ? capitalize(name) : code };
  }).sort((a, b) => a.label.localeCompare(b.label, locale));
}
