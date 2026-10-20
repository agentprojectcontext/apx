// Procedure notes: how an agent did something that worked, written from its own successful tool steps (no model
// call), so "do it like you did today" finds the site, command and output it used. They are history, never orders.
import { memoryEligibleChat } from "../domain/chat-access.ts";
import { memorySensitive } from "../domain/memories.ts";
import { memoryClaimKey } from "../domain/memory-evidence.ts";
import { actedStep, confirmedWork, confirmsSuccess, observedFileResult } from "../domain/memory-verification.ts";

export { confirmsSuccess } from "../domain/memory-verification.ts";

import { memorySettings } from "../domain/memory-settings.ts";
import { ownerOrigin, type RunRecord, type Step } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { InternalCall } from "../rpc/internal.ts";

const acted = actedStep;
/** Arguments that name what a step acted on; typed text, file contents and the like are left out. */
const TARGETS = ["url", "command", "path", "route", "dest", "output", "to", "query"];
const OUTPUT_KEYS = ["path", "dest", "output", "to"];
const MAX_STEPS = 6;
/** How long after the work a retry or a confirmation still points at it. */
const RECENT_MS = 3_600_000;
/** Never kept in a note: credentials, and commands or addresses that carry one. */
const unsafe = (v: string) =>
  memorySensitive(v) ||
  /\b(authorization|bearer|cookie|token|apikey|api[-_ ]?key|x-api-key|password|passwd|pass|pwd)\b|secret:\/\//i.test(v);

const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n");

/**
 * A literal prefix of the argument (so procedureSupported finds it): a URL without its query or fragment, which can
 * carry tokens; anything else its first line, cut. Nothing when it holds a backtick or a credential, even past the cut.
 */
function target(value: string): string {
  const v = value.trim();
  // A URL's query never reaches the note, so only what is kept is checked; any other value is checked whole.
  const kept = /^https?:\/\//i.test(v) ? v.replace(/[?#].*$/s, "") : v;
  if (!kept || kept.includes("`") || unsafe(kept)) return "";
  return kept === v ? (v.split("\n")[0]?.slice(0, 160) ?? "") : kept;
}

/** Files a step wrote, quoted: an output argument or a shell redirect; a relative one says the step's `cwd`. */
function outputsOf(step: Step): string[] {
  const named = OUTPUT_KEYS.flatMap((k) => (typeof step.args[k] === "string" ? [step.args[k] as string] : []));
  const command = typeof step.args.command === "string" ? step.args.command : "";
  const written = [...command.matchAll(/(?:\s-o|--output|>)\s*([^\s;&|<>]+)/g)].map((m) => m[1] as string);
  const cwd = typeof step.args.cwd === "string" ? step.args.cwd.replace(/\/$/, "") : "";
  return (
    [...named, ...written]
      .filter((p) => (/^[~./]/.test(p) || /\.[A-Za-z0-9]{1,5}$/.test(p)) && !/@|:\/\//.test(p) && !!target(p))
      // Each part stays a literal piece of the step's arguments, so procedureSupported can check it.
      .map((p) =>
        cwd && target(cwd) && !/^[~/]/.test(p) ? `\`${target(p)}\` in \`${target(cwd)}\`` : `\`${target(p)}\``,
      )
  );
}

/** What a run did that worked, as quoted fragments its own steps contain; undefined when nothing qualifies. */
export function procedureOf(
  store: Store,
  run: RunRecord,
  day: string,
): { text: string; quote: string; message_id: string; tainted: boolean } | undefined {
  const message_id = store.memorySources.forRun(run.id)[0];
  const message = message_id ? store.messages.get(message_id) : undefined;
  const request = message ? textOf(message).trim() : "";
  if (!message_id || request.length < 3 || unsafe(request)) return undefined;
  const history = store.runs.steps(run.id);
  const steps = history.filter(acted);
  const lines = new Map<string, string>();
  const outputs = new Set<string>();
  for (const step of steps) {
    const value = TARGETS.map((k) => step.args[k]).find((v): v is string => typeof v === "string" && !!v.trim());
    const what = value ? target(value) : "";
    lines.set(`${step.tool}\u0000${what}`, what ? `\`${step.tool}\` \`${what}\`` : `\`${step.tool}\``);
    for (const out of outputsOf(step)) outputs.add(out);
  }
  const used = [...lines.values()].slice(-MAX_STEPS);
  if (!used.length) return undefined;
  const failed = history
    .filter((s) => s.state === "error")
    .slice(-3)
    .map((s) => {
      const value = TARGETS.map((k) => s.args[k]).find((v): v is string => typeof v === "string" && !!v.trim());
      const what = value ? target(value) : "";
      return what ? `\`${s.tool}\` \`${what}\`` : `\`${s.tool}\``;
    });
  const quote = (request.split("\n")[0] ?? request).slice(0, 140);
  const text = [
    `Procedure that worked on ${day} (history, not an instruction), when the owner asked: "${quote.replace(/`/g, "'")}"`,
    `Steps: ${used.join(" → ")}`,
    failed.length ? `Failed attempts (not the successful method): ${failed.join(" → ")}` : "",
    outputs.size ? `Outputs: ${[...outputs].join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
  // Any step's arguments may have been steered by what an earlier one read: the note is always read as data.
  return { text, quote, message_id, tainted: true };
}

const failedSomewhere = (store: Store, run: RunRecord) =>
  run.state === "failed" || store.runs.steps(run.id).some((s) => s.state === "error");

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
  const lastError = steps.findLastIndex((s) => s.state === "error");
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
