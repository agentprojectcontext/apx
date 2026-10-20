import type { MemoryEvidence } from "@apx/protocol";
import { memoryEligibleChat } from "./chat-access.ts";
import { memorySensitive } from "./memories.ts";
import { memoryPlain } from "./memory-content.ts";
import { messageText } from "./memory-evidence.ts";
import { failedStep } from "./procedure-steps.ts";
import { ownerOrigin, type RunRecord, type Step } from "./runs.ts";
import type { Store } from "./store.ts";

const CONFIRMS =
  /^(genial|perfecto|perfect|excelente|joya|buenisimo|barbaro|funciono|anduvo|salio bien|great|awesome|it works|it worked|works|worked|nice)\b/;
const COMPLAINT =
  /\b(pero|but|aunque|however|sin embargo|no|not|nada|nothing|nunca|never|ningun\w*|\w+n t|didnt|doesnt|dont|isnt|wasnt|fall\w*|fail\w*|falt\w*|missing|todavia|still|sigue|igual|error\w*|roto|broke\w*|mal)\b/;
const QUIET = new Set([
  "remember",
  "recall",
  "forget",
  "search_owner_notes",
  "search_chats",
  "read_chat",
  "load_skill",
]);
export const actedStep = (s: Step) => s.state === "ok" && !QUIET.has(s.tool) && !failedStep(s);
export const confirmsSuccess = (text: string) =>
  text.length <= 120 && !/[?¿]/.test(text) && CONFIRMS.test(memoryPlain(text)) && !COMPLAINT.test(memoryPlain(text));

export function confirmedWork(store: Store, messageId: string): RunRecord | undefined {
  const message = store.messages.get(messageId);
  const thread = message && store.threads.get(message.thread_id);
  if (
    message?.author.kind !== "user" ||
    !thread ||
    !memoryEligibleChat(store, thread) ||
    !confirmsSuccess(messageText(message))
  )
    return;
  const work = store.runs
    .list(thread.id, 8)
    .filter((r) => ownerOrigin(r.input?.origin) && r.started_at <= message.created_at)
    .find((r) => store.runs.steps(r.id).some(actedStep));
  const age = work?.ended_at ? Date.parse(message.created_at) - Date.parse(work.ended_at) : -1;
  return work?.state === "completed" && age >= 0 && age < 3_600_000 ? work : undefined;
}

/** Only a complete readback of the written contents proves this narrow, observable outcome. */
export function observedFileResult(steps: Step[]): MemoryEvidence["verification"] | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const read = steps[i];
    if (read?.tool !== "file_read" || read.state !== "ok" || (read.args.offset !== undefined && read.args.offset !== 1))
      continue;
    const range = read.result?.split("\n")[0]?.match(/: lines 1-(\d+) of (\d+)$/);
    if (!range || range[1] !== range[2]) continue;
    const write = steps
      .slice(0, i)
      .findLast(
        (s) =>
          s.tool === "file_write" && s.state === "ok" && s.args.path === read.args.path && s.args.cwd === read.args.cwd,
      );
    const content = write?.args.content;
    if (!write || typeof content !== "string" || !content.trim() || content.length > 8000 || memorySensitive(content))
      continue;
    const body = read.result?.match(/<file\b[^>]*>([\s\S]*?)<\/file>/)?.[1];
    if (body !== `\n${content}\n`) continue;
    return {
      kind: "observed_result",
      criterion: "File contents read back after writing.",
      step_ids: [write.call_id, read.call_id],
    };
  }
  return;
}

export function procedureEvidenceIsLive(store: Store, run: RunRecord, evidence: MemoryEvidence[]): boolean {
  const thread = store.threads.get(run.thread_id);
  if (!thread || !memoryEligibleChat(store, thread) || run.state !== "completed" || !ownerOrigin(run.input?.origin))
    return false;
  const requestIds = store.memorySources.forRun(run.id);
  if (!evidence.some((e) => requestIds.includes(e.message_id))) return false;
  let verified = false;
  for (const e of evidence) {
    const message = store.messages.get(e.message_id);
    if (
      !message ||
      message.thread_id !== thread.id ||
      message.author.kind !== "user" ||
      !messageText(message).includes(e.quote) ||
      memorySensitive(e.quote) ||
      store.memories.excluded({ agent_id: run.agent_id, project_id: thread.project_id }, e.quote, {
        message_id: e.message_id,
        run_id: run.id,
      })
    )
      return false;
    if (!e.verification) {
      if (!requestIds.includes(e.message_id)) return false;
    } else if (e.verification.kind === "owner_confirmation") {
      if (
        e.verification.step_ids !== undefined ||
        confirmedWork(store, message.id)?.id !== run.id ||
        e.verification.criterion !== "The owner confirmed the preceding work."
      )
        return false;
      verified = true;
    } else {
      const observed = observedFileResult(store.runs.steps(run.id));
      if (!requestIds.includes(message.id) || !observed || JSON.stringify(observed) !== JSON.stringify(e.verification))
        return false;
      verified = true;
    }
  }
  return verified;
}
