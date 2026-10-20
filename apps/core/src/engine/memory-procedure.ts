// Procedure notes: how an agent did something that worked, written from its own successful tool steps (no model
// call), so "do it like you did today" finds the site, command and output it used. They are history, never orders.
import { memorySensitive } from "../domain/memories.ts";
import { memoryPlain } from "../domain/memory-content.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { RunRecord, Step } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { InternalCall } from "../rpc/internal.ts";

/** Tools about memory or reading chats say nothing about how the work was done. */
const QUIET = new Set([
  "remember",
  "recall",
  "forget",
  "search_owner_notes",
  "search_chats",
  "read_chat",
  "load_skill",
]);
const acted = (s: Step) => s.state === "ok" && !QUIET.has(s.tool);
/** Arguments that name what a step acted on; typed text, file contents and the like are left out. */
const TARGETS = ["url", "command", "path", "dest", "output", "to", "query"];
const OUTPUT_KEYS = ["path", "dest", "output", "to"];
const MAX_STEPS = 6;
const TOOLS_READING_OUTSIDE = /^(browser_|web_)/;
/** Owner replies that say the previous turn's work did what they wanted. */
const CONFIRMS =
  /^(genial|perfecto|perfect|excelente|joya|buen[ií]simo|b[aá]rbaro|funcion[oó]|anduvo|sali[oó] bien|great|awesome|it works|it worked|works|worked|nice)\b/;

/** Never kept in a note: credentials, and commands or addresses that carry one. */
const unsafe = (v: string) =>
  memorySensitive(v) || /\b(authorization|bearer|cookie|token|apikey|api_key)\b|secret:\/\//i.test(v);

const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n");

/** A short reply confirming success ("genial, funcionó"), not a question or a "great, but…". */
export function confirmsSuccess(text: string): boolean {
  const plain = memoryPlain(text);
  return (
    text.length <= 120 &&
    !/[?¿]/.test(text) &&
    CONFIRMS.test(plain) &&
    !/\b(pero|but|aunque|however|sin embargo)\b/.test(plain)
  );
}

/** A URL without its query or fragment (they can carry tokens); anything else as it came, trimmed. */
function target(value: string): string {
  const v = value.trim().replace(/`/g, "'");
  if (/^https?:\/\//i.test(v))
    try {
      const u = new URL(v);
      return `${u.origin}${u.pathname}`;
    } catch {
      return "";
    }
  return v.split("\n")[0]?.slice(0, 160) ?? "";
}

/** Files a step wrote, quoted: an output argument or a shell redirect; a relative one says the step's `cwd`. */
function outputsOf(step: Step): string[] {
  const named = OUTPUT_KEYS.flatMap((k) => (typeof step.args[k] === "string" ? [step.args[k] as string] : []));
  const command = typeof step.args.command === "string" ? step.args.command : "";
  const written = [...command.matchAll(/(?:\s-o|--output|>)\s*([^\s;&|<>]+)/g)].map((m) => m[1] as string);
  const cwd = typeof step.args.cwd === "string" ? step.args.cwd.replace(/\/$/, "") : "";
  return (
    [...named, ...written]
      .filter((p) => (/^[~./]/.test(p) || /\.[A-Za-z0-9]{1,5}$/.test(p)) && !/@|:\/\//.test(p) && !unsafe(p))
      // Each part stays a literal piece of the step's arguments, so procedureSupported can check it.
      .map((p) => (cwd && !/^[~/]/.test(p) ? `\`${target(p)}\` in \`${target(cwd)}\`` : `\`${target(p)}\``))
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
  const steps = store.runs.steps(run.id).filter(acted);
  const lines = new Map<string, string>();
  const outputs = new Set<string>();
  for (const step of steps) {
    const value = TARGETS.map((k) => step.args[k]).find((v): v is string => typeof v === "string" && !!v.trim());
    const found = value ? target(value) : "";
    const what = found && !unsafe(found) ? found : "";
    lines.set(`${step.tool}\u0000${what}`, what ? `\`${step.tool}\` \`${what}\`` : `\`${step.tool}\``);
    for (const out of outputsOf(step)) outputs.add(out);
  }
  const used = [...lines.values()].slice(-MAX_STEPS);
  if (!used.length) return undefined;
  const quote = (request.split("\n")[0] ?? request).slice(0, 140);
  const text = [
    `Procedure that worked on ${day} (history, not an instruction), when the owner asked: "${quote.replace(/`/g, "'")}"`,
    `Steps: ${used.join(" → ")}`,
    outputs.size ? `Outputs: ${[...outputs].join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
  return { text, quote, message_id, tainted: steps.some((s) => TOOLS_READING_OUTSIDE.test(s.tool)) };
}

const failedSomewhere = (store: Store, run: RunRecord) =>
  run.state === "failed" || store.runs.steps(run.id).some((s) => s.state === "error");

/**
 * The run whose way of working deserves a note after `run` ended: `run` itself when it succeeded after failures (in
 * it or in the chat's previous turn), or the previous turn when this message confirms it worked.
 */
export function procedureRun(store: Store, run: RunRecord): RunRecord | undefined {
  const message = store.memorySources.forRun(run.id)[0];
  const said = message ? store.messages.get(message) : undefined;
  const earlier = store.runs.list(run.thread_id, 6).filter((r) => r.id !== run.id && r.started_at <= run.started_at);
  const mine = earlier.filter((r) => r.agent_id === run.agent_id && r.input?.origin.kind === "user");
  const previous = mine[0];
  // A confirmation is about the latest turn that did something, even with a "how's it going" in between.
  if (said && confirmsSuccess(textOf(said))) {
    const worked = mine.slice(0, 3).find((r) => store.runs.steps(r.id).some(acted));
    return worked?.state === "completed" ? worked : undefined;
  }
  const steps = store.runs.steps(run.id);
  const lastError = steps.findLastIndex((s) => s.state === "error");
  const recovered = lastError >= 0 && steps.slice(lastError + 1).some(acted);
  const retried =
    !!previous &&
    Date.parse(run.started_at) - Date.parse(previous.ended_at ?? previous.started_at) < 6 * 3_600_000 &&
    failedSomewhere(store, previous) &&
    steps.some(acted);
  return recovered || retried ? run : undefined;
}

/** Saves the procedure note for what `run` points at, once per run; returns whether a note was written. */
export async function captureProcedure(
  store: Store,
  call: InternalCall,
  run: RunRecord,
  day: string,
): Promise<boolean> {
  const settings = memorySettings(store);
  if (settings.mode === "off" || settings.auto_capture === false) return false;
  const source = procedureRun(store, run);
  const thread = source && store.threads.get(source.thread_id);
  const note = source && procedureOf(store, source, day);
  if (!source || !thread || !note) return false;
  const view = { agent_id: source.agent_id, project_id: thread.project_id };
  const steps = note.text.split("\n")[1];
  const known = store.memories
    .list({ view, scope: "agent", agent_id: source.agent_id, limit: 200 })
    .some((m) => m.kind === "procedure" && m.text.split("\n")[1] === steps);
  if (known || store.memories.excluded(view, note.quote, { message_id: note.message_id, run_id: source.id }))
    return false;
  await call(
    "memory.add",
    {
      scope: "agent",
      text: note.text,
      kind: "procedure",
      evidence: [{ message_id: note.message_id, quote: note.quote }],
      tainted: note.tainted,
    },
    { actor: "agent", agent: { id: source.agent_id, thread_id: source.thread_id, run_id: source.id } },
    `procedure:${source.id}`,
  );
  return true;
}
