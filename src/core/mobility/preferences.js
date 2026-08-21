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
