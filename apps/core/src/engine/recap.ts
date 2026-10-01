// Claude Code and Codex keep their own transcript per thread. Turns answered in the same thread by another engine
// are not in it, so before handing them a turn we tell them what was said meanwhile (text only, newest last).
import type { HarnessId, Part } from "@apx/protocol";
import { engineOf } from "../domain/refs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { untrusted } from "../tools/result.ts";

const MAX_TURNS = 12;
const MAX_CHARS = 12_000;

/** Whose transcript a turn lives in: an ACP agent's (by engine) or the harness's own. */
export const sessionKey = (harness: HarnessId | undefined, ref: string | undefined): string =>
  harness === "acp" ? engineOf(ref ?? "") : (harness ?? "native");

export function recapFor(store: Store, threadId: string, key: string, currentRunId: string): string {
  const since = store.harnessSessions.updatedAt(threadId, key);
  const keyOf = (r: RunRecord) => sessionKey(r.harness, r.model);
  const runs = store.runs
    .list(threadId, 50)
    .filter((r) => r.id !== currentRunId && r.state === "completed" && keyOf(r) !== key)
    .filter((r) => !since || r.started_at > since)
    .slice(0, MAX_TURNS)
    .reverse();
  if (!runs.length) return "";
  const lines: string[] = [];
  for (const r of runs) {
    const msg = r.message_id ? store.messages.get(r.message_id) : undefined;
    const answer = msg?.parts.find((p): p is Extract<Part, { type: "text" }> => p.type === "text")?.text ?? "";
    lines.push(`Owner: ${r.input?.text ?? ""}`, `You (answered with ${r.harness ?? "another engine"}): ${answer}`);
  }
  let text = lines.join("\n");
  if (text.length > MAX_CHARS) text = `…${text.slice(-MAX_CHARS)}`;
  return `${untrusted("earlier_turns", { note: "said in this thread while another engine answered" }, text)}\n\n`;
}
