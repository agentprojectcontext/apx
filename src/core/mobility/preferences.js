import fs from "node:fs";
import path from "node:path";
import { MOBILITY_PATH } from "#core/config/paths.js";

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function read() {
  try {
    const value = JSON.parse(fs.readFileSync(MOBILITY_PATH, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function write(value) {
  fs.mkdirSync(path.dirname(MOBILITY_PATH), { recursive: true });
  fs.writeFileSync(MOBILITY_PATH, JSON.stringify(value, null, 2));
}

export function silenceMobilityToday(now = new Date()) {
  const state = read();
  state.silent_day = dayKey(now);
  write(state);
  return state.silent_day;
}

export function isMobilitySilentToday(now = new Date()) {
  return read().silent_day === dayKey(now);
}

export function isMobilitySilenceCommand(text = "") {
  const normalized = String(text).toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
  return /(?:no me (?:comentes|avises|molestes)|no (?:comentes|avises)|silencio).*(?:por )?hoy/.test(normalized);
}

export function _resetMobilityPreferencesForTest() {
  try { fs.rmSync(MOBILITY_PATH, { force: true }); } catch { /* nothing to remove */ }
}

// ── where a mobility reminder is delivered ──────────────────────────────────
//
// It used to be "Telegram, always", because Telegram was the only surface that
// could draw a card with buttons. That is no longer true: the alert is its own
// frame on the events socket and the phone renders it natively, so the Telegram
// copy became a second notification for the same event — which is how a chat
// used for everything else fills up with driving reminders.
//
// APP IS THE DEFAULT. The reminder is for someone at the wheel, and the surface
// they are looking at is the phone in the cradle or the head unit, not a chat.

/** Every delivery surface a mobility reminder can use. */
export const MOBILITY_SURFACES = Object.freeze(["app", "telegram"]);

/** What ships when nothing is configured. */
export const DEFAULT_MOBILITY_SURFACES = Object.freeze(["app"]);

/**
 * Which surfaces this install delivers mobility reminders on.
 *
 * Accepts what a person would plausibly write in config.json or type at the
 * CLI: a list, a single string, "both", or "none" to turn reminders off
 * without unpairing anything.
 *
 *   config.mobility.notify = "app" | "telegram" | "both" | "none" | [..]
 *
 * Anything unrecognised falls back to the default rather than delivering
 * nowhere — a typo in a config file must not silently disable the alerts.
 *
 * @returns {{app: boolean, telegram: boolean}}
 */
export function mobilitySurfaces(globalConfig) {
  const raw = globalConfig?.mobility?.notify;
  if (raw === "none" || (Array.isArray(raw) && raw.length === 0)) {
    return { app: false, telegram: false };
  }
  const list = raw === "both"
    ? MOBILITY_SURFACES
    : Array.isArray(raw)
      ? raw
      : typeof raw === "string" && raw.trim()
        ? [raw]
        : DEFAULT_MOBILITY_SURFACES;
  const wanted = list
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => MOBILITY_SURFACES.includes(s));
  const chosen = wanted.length ? wanted : DEFAULT_MOBILITY_SURFACES;
  return { app: chosen.includes("app"), telegram: chosen.includes("telegram") };
}
