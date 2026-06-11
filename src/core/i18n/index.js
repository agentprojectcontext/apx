// Backend i18n for daemon-side messages (Telegram heads-up, system replies,
// any other user-facing string emitted from the host/core layer). The web
// admin has its own dict tree under src/interfaces/web/src/i18n/ — that one
// stays separate, this is for what the daemon sends back.
//
// Usage:
//   import { t, resolveLang } from "#core/i18n/index.js";
//   const lang = resolveLang(globalConfig);
//   await sendTelegram(t("telegram.heads_up", { lang }));
//
// Adding a key: pick a clear dotted path, add it to every locale dict, and
// the unit test in tests/i18n.test.js will assert parity (no missing
// translations). Values can include {var} placeholders that t() will fill.
import en from "./en.js";
import es from "./es.js";
import pt from "./pt.js";

const DICTS = Object.freeze({ en, es, pt });
const DEFAULT_LANG = "es";

/**
 * Pull the user's preferred language code from a globalConfig snapshot.
 * Falls back to DEFAULT_LANG when nothing is set. The 2-char slice keeps
 * "es-AR" / "en-US" / "pt-BR" working without per-region dicts.
 */
export function resolveLang(globalConfig) {
  const raw = globalConfig?.user?.language;
  return String(raw || DEFAULT_LANG).slice(0, 2).toLowerCase();
}

function format(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Translate a key into the active locale. Missing keys fall back through:
 *   requested lang → DEFAULT_LANG → the key itself (as a last-resort
 *   placeholder so the caller can spot the gap).
 */
export function t(key, { lang = DEFAULT_LANG, vars } = {}) {
  const code = String(lang || DEFAULT_LANG).slice(0, 2).toLowerCase();
  const dict = DICTS[code] || DICTS[DEFAULT_LANG];
  const value = dict?.[key] ?? DICTS[DEFAULT_LANG]?.[key] ?? key;
  return format(value, vars);
}

/** Lower-level: get the active dict, e.g. for bulk lookups in a loop. */
export function getDict(lang) {
  const code = String(lang || DEFAULT_LANG).slice(0, 2).toLowerCase();
  return DICTS[code] || DICTS[DEFAULT_LANG];
}

export { DICTS, DEFAULT_LANG };
