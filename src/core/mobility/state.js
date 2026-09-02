import fs from "node:fs";
import path from "node:path";
import { MOBILITY_PATH } from "#core/config/paths.js";

const RECENT_QUESTION_MS = 20 * 60_000;

let current = null;
let lastQuestion = null;
let lastResponse = null;
let alerts = [];
let loadedPath = null;

// A proximity alert outlives the trip that produced it: the follow-up ("did you
// actually stop there?") is asked once the driving is over. So the log is
// persisted, not just held in memory — a daemon restart mid-trip must not
// re-announce a place the owner was already told about. Bounded, because this
// is a reminder log and not a location history.
const MAX_ALERTS = 50;

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
  const file = readFile();
  const saved = file.mobility_context || {};
  current = saved.trip || null;
  lastQuestion = saved.last_question || null;
  lastResponse = saved.last_response || null;
  alerts = Array.isArray(file.mobility_alerts) ? file.mobility_alerts : [];
  loadedPath = MOBILITY_PATH;
}

function persist() {
  const state = readFile();
  state.mobility_context = {
    trip: current,
    last_question: lastQuestion,
    last_response: lastResponse,
  };
  state.mobility_alerts = alerts.slice(-MAX_ALERTS);
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

/**
 * The identity of a proximity alert: one ERRAND, on one trip.
 *
 * Deliberately NOT keyed on the place. "Buy ibuprofen at a pharmacy" is one
 * errand; the nearest pharmacy is its answer, not thirteen separate reminders.
 * A drive through Bariloche found fifteen matching shops for two tasks and sent
 * eight Telegram messages in ninety seconds — the per-place key was the bug.
 * Once the owner has been told where to stop for something, they have been
 * told.
 */
export function mobilityAlertKey(tripId, taskId) {
  return `${clean(tripId, 100)}|${clean(taskId, 100)}`;
}

/** Has this errand already been announced on this trip? */
export function mobilityAlertFired(tripId, taskId) {
  ensureLoaded();
  const key = mobilityAlertKey(tripId, taskId);
  return alerts.some((alert) => alert.key === key);
}

/**
 * Record an alert the daemon is about to deliver. Written BEFORE the send, so a
 * failed Telegram call still burns the one-shot: a delivery that errored is not
 * a reason to try the same reminder again on the next GPS sample two seconds
 * later. Returns the stored record (with its id).
 */
export function recordMobilityAlert(alert, now = Date.now()) {
  ensureLoaded();
  const record = {
    id: `mb${Math.random().toString(36).slice(2, 8)}`,
    key: mobilityAlertKey(alert.trip_id, alert.task_id),
    trip_id: clean(alert.trip_id, 100),
    task_id: clean(alert.task_id, 100),
    task: clean(alert.task, 200),
    project_id: clean(String(alert.project_id ?? ""), 100),
    place: clean(alert.place, 200),
    latitude: Number(alert.latitude),
    longitude: Number(alert.longitude),
    distance_m: Number(alert.distance_m) || 0,
    fired_at: new Date(now).toISOString(),
    answer: null,
    answered_at: null,
    followup_at: null,
    outcome: null,
  };
  alerts = [...alerts, record].slice(-MAX_ALERTS);
  persist();
  return record;
}

/** Every recorded alert, newest last. Read-only copies. */
export function listMobilityAlerts() {
  ensureLoaded();
  return alerts.map((alert) => ({ ...alert }));
}

export function getMobilityAlert(id) {
  ensureLoaded();
  const found = alerts.find((alert) => alert.id === id);
  return found ? { ...found } : null;
}

export function updateMobilityAlert(id, patch, now = Date.now()) {
  ensureLoaded();
  const index = alerts.findIndex((alert) => alert.id === id);
  if (index < 0) return null;
  alerts[index] = { ...alerts[index], ...patch, updated_at: new Date(now).toISOString() };
  persist();
  return { ...alerts[index] };
}

/**
 * Alerts the owner said yes to and has not been asked back about. This is the
 * whole point of keeping the log: "voy" is a promise, and the assistant that
 * never asks how it went is a notification, not a secretary.
 */
export function pendingMobilityFollowups(tripId = null) {
  ensureLoaded();
  return alerts
    .filter((alert) => alert.answer === "go" && !alert.followup_at && !alert.outcome)
    .filter((alert) => !tripId || alert.trip_id === tripId)
    .map((alert) => ({ ...alert }));
}

export function _resetMobilityStateForTest() {
  ensureLoaded();
  current = null;
  lastQuestion = null;
  lastResponse = null;
  alerts = [];
}
