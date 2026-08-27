// In-flight routine runs — what a routine is doing RIGHT NOW.
//
// Why this exists: `runRoutineNow` is a promise, and the surface that started
// it held the only evidence the run existed. Press Play in the panel, refresh
// the tab, and a routine that had been working for four minutes looked idle —
// same from a second device, which never saw it start at all. Worse, there was
// nothing to look at even in the tab that DID start it: a run's messages are
// written to the ledger once, at the end (recordAgentTurn), so "what is it
// doing?" had no answer anywhere until it was already over.
//
// This registry is that answer: the open runs, the phase each is in, and the
// steps taken so far, plus a bus event per change so any surface can follow
// along live. Pure in-memory runtime state — the mirror of
// host/daemon/active-turns.js for chat turns. A daemon restart clears it, which
// is right: the run died with the process.
//
// Layering (rule 8): core emits on the bus and never listens. The daemon maps
// the project root to an id and fans the frames out (host/daemon/events-ws.js).
import { emitRoutineEvent } from "#core/events/bus.js";
import { maskSecretValues } from "#core/config/secret-values.js";

// A run's step list is a live preview, not a record — the ledger keeps the real
// trace. These caps are the wire budget for a frame, not a memory policy.
const MAX_STEPS = 60;
const MAX_TEXT = 8000;
const MAX_ARGS_JSON = 600;

/** The phases a run walks through, in order. Mirrors the runner's pipeline. */
export const RUN_PHASES = ["pre", "agent", "delivery", "post"];

let seq = 0;
const byId = new Map();  // runId -> record
const byKey = new Map(); // key   -> runId (the latest run of that routine)

/** Key for one routine's run. Routines are per-project and keyed by name. */
export function runKey(projectRoot, name) {
  return `${projectRoot || ""}|${name}`;
}

/** Args as a one-line preview. NOT summarizeForTrace (core/agent/run-agent.js):
 *  that one decides what gets PERSISTED into history and keeps the shape; this
 *  decides what fits in a live frame, and a shell script pasted whole does not.
 *
 *  Masked on the way out: this is a BROADCAST — every connected panel gets it —
 *  and an agent that inlines a key into a shell command would otherwise put it
 *  on the wire. Only registered secrets are caught (core/config/secret-values.js),
 *  which is the same floor the daemon log has. */
function clipArgs(args) {
  if (!args || typeof args !== "object") return null;
  let json;
  try { json = maskSecretValues(JSON.stringify(args)); } catch { return null; }
  if (json.length > MAX_ARGS_JSON) return { _preview: `${json.slice(0, MAX_ARGS_JSON)}…` };
  try { return JSON.parse(json); } catch { return { _preview: json }; }
}

/** The shape that leaves this module — for the HTTP route and the live frame. */
function publicRun(rec) {
  return {
    run_id: rec.id,
    routine: rec.routine,
    kind: rec.kind,
    trigger: rec.trigger,
    started_at: rec.started_at,
    phase: rec.phase,
    agent_slug: rec.agent_slug || null,
    steps: rec.steps,
    text: rec.text,
    ...(rec.ended_at ? { ended_at: rec.ended_at, status: rec.status, error: rec.error } : {}),
    ...(rec.conversation_id ? { conversation_id: rec.conversation_id } : {}),
  };
}

function announce(rec, phase) {
  emitRoutineEvent({
    phase,
    project_root: rec.project_root,
    routine: rec.routine,
    run: publicRun(rec),
  });
}

/**
 * Open a run. `trigger` says who asked — manual (the panel or the CLI),
 * schedule (the daemon's scheduler), agent (the run_routine tool) — because
 * "why is this running?" is the first question a run appearing out of nowhere
 * raises.
 */
export function startRoutineRun({ projectRoot, routine, trigger = "manual" }) {
  const id = `run_${Date.now().toString(36)}_${++seq}`;
  const rec = {
    id,
    key: runKey(projectRoot, routine?.name),
    project_root: projectRoot || "",
    routine: routine?.name || "",
    kind: routine?.kind || "",
    trigger,
    started_at: new Date().toISOString(),
    phase: RUN_PHASES[0],
    agent_slug: routine?.kind === "exec_agent" ? String(routine?.spec?.agent || "") : "",
    steps: [],
    text: "",
    ended_at: null,
    status: null,
    error: null,
    conversation_id: null,
  };
  byId.set(id, rec);
  byKey.set(rec.key, id);
  announce(rec, "start");
  return rec;
}

/** Move the run to a pipeline phase (pre → agent → delivery → post). */
export function setRoutineRunPhase(id, phase) {
  const rec = byId.get(id);
  if (!rec || rec.phase === phase) return;
  rec.phase = phase;
  announce(rec, "progress");
}

function pushStep(rec, step) {
  rec.steps.push({ at: new Date().toISOString(), ...step });
  // Oldest first out: what a run did five minutes ago is in the ledger, what
  // it is doing now is only here.
  if (rec.steps.length > MAX_STEPS) rec.steps.splice(0, rec.steps.length - MAX_STEPS);
}

/** A tool call started. `traceId` is the agent loop's own id, so the matching
 *  result lands on the same step instead of appending a second one. */
export function startRoutineRunTool(id, { traceId, tool, args }) {
  const rec = byId.get(id);
  if (!rec || !tool) return;
  pushStep(rec, { id: String(traceId || rec.steps.length + 1), kind: "tool", tool, args: clipArgs(args), status: "running" });
  announce(rec, "progress");
}

/** That tool call came back. Marks the open step done (or error). */
export function finishRoutineRunTool(id, { traceId, tool, result }) {
  const rec = byId.get(id);
  if (!rec) return;
  const step = [...rec.steps].reverse().find((s) => s.kind === "tool" && (traceId ? s.id === String(traceId) : s.tool === tool) && s.status === "running");
  const failed = !!(result && typeof result === "object" && "error" in result && result.error);
  if (step) {
    step.status = failed ? "error" : "done";
  } else {
    pushStep(rec, { id: String(traceId || rec.steps.length + 1), kind: "tool", tool, args: null, status: failed ? "error" : "done" });
  }
  announce(rec, "progress");
}

/** The model said something out loud mid-run. */
export function addRoutineRunText(id, text) {
  const rec = byId.get(id);
  const clean = String(text || "").trim();
  if (!rec || !clean) return;
  pushStep(rec, { id: `t${rec.steps.length + 1}`, kind: "text", text: maskSecretValues(clean.slice(0, 2000)) });
  rec.text = maskSecretValues(`${rec.text}${rec.text ? "\n\n" : ""}${clean}`.slice(-MAX_TEXT));
  announce(rec, "progress");
}

/** Name the conversation this run is filing into, once it is known. The panel
 *  needs it to offer "open the chat" on the run. */
export function setRoutineRunConversation(id, { conversationId, agentSlug }) {
  const rec = byId.get(id);
  if (!rec) return;
  if (conversationId) rec.conversation_id = conversationId;
  if (agentSlug) rec.agent_slug = agentSlug;
  announce(rec, "progress");
}

/** Close the run. Idempotent — the finally block and an error path both call it.
 *  The closing frame carries the outcome so a panel can drop the live row and
 *  revalidate the executions list in one move.
 *
 *  `text` is the run's ANSWER, and it is set here rather than accumulated: the
 *  agent loop only announces text on iterations that also called a tool (see
 *  run-agent.js — the final turn breaks out before it announces), so the last
 *  thing a run says would otherwise never reach a live watcher at all. */
export function endRoutineRun(id, { status = "ok", error = null, conversationId = null, agentSlug = null, text = null } = {}) {
  const rec = byId.get(id);
  if (!rec) return;
  if (text) rec.text = maskSecretValues(String(text).slice(-MAX_TEXT));
  rec.ended_at = new Date().toISOString();
  rec.status = status;
  rec.error = error;
  if (conversationId) rec.conversation_id = conversationId;
  if (agentSlug) rec.agent_slug = agentSlug;
  byId.delete(id);
  if (byKey.get(rec.key) === id) byKey.delete(rec.key);
  announce(rec, "end");
}

/** The run this routine has open right now, if any. */
export function getRoutineRun(projectRoot, name) {
  const id = byKey.get(runKey(projectRoot, name));
  const rec = id ? byId.get(id) : null;
  return rec ? publicRun(rec) : null;
}

/** Every run open in this project — what the routines list marks as running. */
export function listRoutineRuns(projectRoot) {
  const out = [];
  for (const rec of byId.values()) {
    if (rec.project_root === (projectRoot || "")) out.push(publicRun(rec));
  }
  return out;
}

/** Test seam: forget every open run. */
export function resetRoutineRuns() {
  byId.clear();
  byKey.clear();
}
