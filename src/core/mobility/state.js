import fs from "node:fs";
import path from "node:path";
import { MOBILITY_PATH } from "#core/config/paths.js";

const RECENT_QUESTION_MS = 20 * 60_000;

let current = null;
let lastQuestion = null;
let lastResponse = null;
let loadedPath = null;

function clean(value, max = 900) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readFile() {
  try {
    const value = JSON.parse(fs.readFileSync(MOBILITY_PATH, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function ensureLoaded() {
  if (loadedPath === MOBILITY_PATH) return;
  const saved = readFile().mobility_context || {};
  current = saved.trip || null;
  lastQuestion = saved.last_question || null;
  lastResponse = saved.last_response || null;
  loadedPath = MOBILITY_PATH;
}

function persist() {
  const state = readFile();
  state.mobility_context = {
    trip: current,
    last_question: lastQuestion,
    last_response: lastResponse,
  };
  fs.mkdirSync(path.dirname(MOBILITY_PATH), { recursive: true });
  fs.writeFileSync(MOBILITY_PATH, JSON.stringify(state, null, 2));
}

export function observeMobilityEvent(event, now = Date.now()) {
  ensureLoaded();
  if (!event || event.duplicate) return;
  if (event.type === "trip.ended") {
    if (!current || !event.trip_id || current.trip_id === event.trip_id) {
      current = current ? { ...current, active: false, ended_at: event.occurred_at } : null;
    }
    persist();
    return;
  }
  if (event.type !== "trip.started") return;
  current = {
    active: true,
    trip_id: clean(event.trip_id, 100),
    destination: clean(event.destination, 300),
    origin: event.origin || null,
    started_at: clean(event.occurred_at, 50) || new Date(now).toISOString(),
    observed_at: new Date(now).toISOString(),
  };
  persist();
}

export function recordMobilityQuestion(message, now = Date.now()) {
  ensureLoaded();
  lastQuestion = { text: clean(message), at: new Date(now).toISOString(), at_ms: now };
  persist();
}

export function recordMobilityResponse(action, now = Date.now()) {
  ensureLoaded();
  lastResponse = { action: clean(action, 40), at: new Date(now).toISOString(), at_ms: now };
  persist();
}

export function mobilityQuestionIsRecent(now = Date.now()) {
  ensureLoaded();
  return Boolean(lastQuestion && now - lastQuestion.at_ms < RECENT_QUESTION_MS);
}

export function mobilityContext() {
  ensureLoaded();
  return {
    trip: current ? { ...current } : null,
    last_question: lastQuestion ? { text: lastQuestion.text, at: lastQuestion.at } : null,
    last_response: lastResponse ? { action: lastResponse.action, at: lastResponse.at } : null,
  };
}

export function mobilityContextBlock() {
  const state = mobilityContext();
  if (!state.trip && !state.last_question && !state.last_response) return "";
  const lines = [
    "[CONTEXTO DE MOVILIDAD]",
    state.trip
      ? `Viaje: ${state.trip.active ? "activo" : "finalizado"}; destino: ${state.trip.destination || "desconocido"}; inicio: ${state.trip.started_at || "desconocido"}.`
      : "Viaje: sin datos.",
  ];
  if (state.last_question) lines.push(`Última pregunta de Roby: ${state.last_question.text} (${state.last_question.at}).`);
  if (state.last_response) lines.push(`Última respuesta del usuario: ${state.last_response.action} (${state.last_response.at}).`);
  lines.push("Usá este estado como contexto de secretaria. No anuncies el viaje ni repitas preguntas solo porque el estado cambió.");
  return lines.join("\n");
}

export function _resetMobilityStateForTest() {
  ensureLoaded();
  current = null;
  lastQuestion = null;
  lastResponse = null;
}
