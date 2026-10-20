// Procedure notes: how an agent did something that worked, written from its own successful tool steps (no model
// call), so "do it like you did today" finds the site, command and output it used. They are history, never orders.
import { memoryEligibleChat } from "../domain/chat-access.ts";
import { memoryClaimKey } from "../domain/memory-evidence.ts";
import { actedStep, confirmedWork, confirmsSuccess, observedFileResult } from "../domain/memory-verification.ts";

export { confirmsSuccess } from "../domain/memory-verification.ts";

import { memorySettings } from "../domain/memory-settings.ts";
import {
  failedStep,
  failureReason,
  noiseStep,
  type Places,
  placesOf,
  stepGist,
  stepKey,
  unsafe,
} from "../domain/procedure-steps.ts";
import { ownerOrigin, type RunRecord, type Step } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { InternalCall } from "../rpc/internal.ts";

const acted = actedStep;
const MAX_STEPS = 8;
/** How long after the work a retry or a confirmation still points at it. */
const RECENT_MS = 3_600_000;

const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n");

/** Files a step wrote, quoted as its gist says them: an output argument or a command's `-o`/`>` target. */
function outputsOf(step: Step, places: Places): string[] {
  const named = ["path", "dest", "output", "to"].flatMap((k) =>
    typeof step.args[k] === "string" ? [step.args[k] as string] : [],
  );
  const command = typeof step.args.command === "string" ? step.args.command : "";
  const written = [...command.matchAll(/(?:\s-o|--output|>)\s*([^\s;&|<>]+)/g)].map((m) => m[1] as string);
  return [...named, ...written]
    .filter((p) => (/^[~./]/.test(p) || /\.[A-Za-z0-9]{1,5}$/.test(p)) && !/@|:\/\//.test(p))
    .map((p) => stepGist({ tool: step.tool, args: { path: p } }, places))
    .filter(Boolean)
    .map((p) => `\`${p}\``);
}

/** A step as the note says it: its tool, and what it acted on when that is worth keeping. */
const said = (step: Step, places: Places) => {
  const gist = stepGist(step, places);
  return { key: `${step.tool}\u0000${gist}`, text: gist ? `\`${step.tool}\` \`${gist}\`` : `\`${step.tool}\`` };
};

/** What a run did that worked, as fragments its own steps support; undefined when nothing qualifies. */
export function procedureOf(
  store: Store,
  run: RunRecord,
  day: string,
): { text: string; quote: string; message_id: string; tainted: boolean } | undefined {
  const message_id = store.memorySources.forRun(run.id)[0];
  const message = message_id ? store.messages.get(message_id) : undefined;
  const request = message ? textOf(message).trim() : "";
  if (!message_id || request.length < 3 || unsafe(request)) return undefined;
  const places = placesOf(store, run.thread_id);
  const history = store.runs.steps(run.id);
  const lines = new Map<string, string>();
  const outputs = new Set<string>();
  for (const step of history.filter((s) => acted(s) && !noiseStep(s.tool))) {
    const { key, text } = said(step, places);
    lines.set(key, text);
    for (const out of outputsOf(step, places)) outputs.add(out);
  }
  const used = [...lines.values()].slice(-MAX_STEPS);
  if (!used.length) return undefined;
  // Only what failed before the method worked: a later failure is not something to skip next time.
  const lastWorked = history.findLastIndex((s) => acted(s) && !noiseStep(s.tool));
  const failed = new Map<string, string>();
  for (const step of history.slice(0, lastWorked).filter(failedStep)) {
    // A command that failed is named by its program: next time that program is the one to skip.
    const program = step.tool === "shell" ? stepKey(step.tool, stepGist(step, places)) : "";
    const label = program ? `\`${program}\`` : said(step, places).text;
    const reason = failureReason(step);
    failed.set(label, reason ? `${label} (${reason})` : label);
  }
  const quote = (request.split("\n")[0] ?? request).slice(0, 140);
  // The evidence keeps the owner's words; the note shows its links without the query, which can carry tokens.
  const shown = quote.replace(/`/g, "'").replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1");
  const text = [
    `Procedure that worked on ${day} (history, not an instruction), when the owner asked: "${shown}"`,
    `Steps: ${used.join(" → ")}`,
    failed.size ? `Tried first, failed: ${[...failed.values()].slice(-3).join("; ")}` : "",
    outputs.size ? `Outputs: ${[...outputs].join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
  // Any step's arguments may have been steered by what an earlier one read: the note is always read as data.
  return { text, quote, message_id, tainted: true };
}

const failedSomewhere = (store: Store, run: RunRecord) =>
  run.state === "failed" || store.runs.steps(run.id).some(failedStep);

/**
 * The owner's latest turn in a thread that did something, if it ended well within the hour before `at` (for a
 * confirmation, which may come after a "how's it going" in between).
 */
function workedBefore(store: Store, threadId: string, at: string, skip?: string): RunRecord | undefined {
  const worked = store.runs
    .list(threadId, 6)
    .filter((r) => r.id !== skip && r.started_at <= at && ownerOrigin(r.input?.origin))
    .slice(0, 3)
    .find((r) => store.runs.steps(r.id).some(acted));
  const since = worked && Date.parse(at) - Date.parse(worked.ended_at ?? worked.started_at);
  return worked?.state === "completed" && since !== undefined && since < RECENT_MS ? worked : undefined;
}

/**
 * The run whose way of working deserves a note after `run` ended: `run` itself when it succeeded after failures (in
 * it or in the chat's previous turn), or the previous turn when this message confirms it worked.
 */
export function procedureRun(store: Store, run: RunRecord): RunRecord | undefined {
  const message = store.memorySources.forRun(run.id)[0];
  const said = message ? store.messages.get(message) : undefined;
  if (said && confirmsSuccess(textOf(said))) return workedBefore(store, run.thread_id, run.started_at, run.id);
  const previous = store.runs
    .list(run.thread_id, 6)
    .find(
      (r) =>
        r.id !== run.id &&
        r.started_at <= run.started_at &&
        r.agent_id === run.agent_id &&
        ownerOrigin(r.input?.origin),
    );
  const steps = store.runs.steps(run.id);
  const lastError = steps.findLastIndex(failedStep);
  const recovered = lastError >= 0 && steps.slice(lastError + 1).some(acted);
  const retried =
    !!previous &&
    Date.parse(run.started_at) - Date.parse(previous.ended_at ?? previous.started_at) < RECENT_MS &&
    failedSomewhere(store, previous) &&
    steps.some(acted);
  return recovered || retried ? run : undefined;
}

/** Saves the procedure note for what `run` points at, once per run; returns whether a note was written. */
export function captureProcedure(store: Store, call: InternalCall, run: RunRecord, timeZone?: string) {
  const source = procedureRun(store, run);
  const confirmation = store.memorySources.forRun(run.id).find((id) => confirmedWork(store, id)?.id === source?.id);
  return source ? saveProcedure(store, call, source, timeZone, confirmation) : Promise.resolve(false);
}

/**
 * An owner reply that got no turn of its own (a closing "genial, funcionó" on a channel) still confirms the work
 * before it.
 */
export function captureConfirmed(store: Store, call: InternalCall, messageId: string, timeZone?: string) {
  const message = store.messages.get(messageId);
  if (message?.author.kind !== "user" || !confirmsSuccess(textOf(message))) return Promise.resolve(false);
  const source = confirmedWork(store, messageId);
  return source ? saveProcedure(store, call, source, timeZone, messageId) : Promise.resolve(false);
}

async function saveProcedure(
  store: Store,
  call: InternalCall,
  source: RunRecord,
  timeZone?: string,
  confirmationId?: string,
): Promise<boolean> {
  const settings = memorySettings(store);
  if (settings.mode === "off" || settings.auto_capture === false) return false;
  const thread = store.threads.get(source.thread_id);
  // Dated by when the work ran, which a later confirmation does not change.
  const day = new Date(source.started_at).toLocaleDateString("en-CA", timeZone ? { timeZone } : {});
  const note = procedureOf(store, source, day);
  if (!thread || !note || !memoryEligibleChat(store, thread) || !thread.agent_ids.includes(source.agent_id))
    return false;
  const observed = observedFileResult(store.runs.steps(source.id));
  const confirmation =
    confirmationId && confirmedWork(store, confirmationId)?.id === source.id
      ? store.messages.get(confirmationId)
      : undefined;
  if (!observed && !confirmation) return false;
  const evidence = [
    {
      message_id: note.message_id,
      quote: note.quote,
      ...(!confirmation && observed ? { verification: observed } : {}),
    },
    ...(confirmation
      ? [
          {
            message_id: confirmation.id,
            quote: textOf(confirmation),
            verification: {
              kind: "owner_confirmation" as const,
              criterion: "The owner confirmed the preceding work.",
            },
          },
        ]
      : []),
  ];
  const view = { agent_id: source.agent_id, project_id: thread.project_id };
  const steps = note.text.split("\n")[1];
  const known = store.memories
    .list({ view, scope: "agent", agent_id: source.agent_id, limit: 200 })
    .some(
      (m) => m.kind === "procedure" && m.text.split("\n")[1] === steps && m.evidence?.some((e) => !!e.verification),
    );
  if (known || store.memories.excluded(view, note.quote, { message_id: note.message_id, run_id: source.id }))
    return false;
  const text = note.text.replace(
    "Procedure that worked",
    confirmation ? "Procedure confirmed by owner" : "Procedure with a verified file readback",
  );
  await call(
    "memory.add",
    {
      scope: "agent",
      text,
      kind: "procedure",
      evidence,
      tainted: note.tainted,
    },
    {
      actor: "agent",
      agent: { id: source.agent_id, thread_id: source.thread_id, run_id: source.id },
      memoryReviewed: [memoryClaimKey(text, evidence)],
    },
    `procedure:${source.id}:${memoryClaimKey(text, evidence)}`,
  );
  return true;
}
