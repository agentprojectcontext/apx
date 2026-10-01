// Claude Code and Codex keep their own transcript per thread. Turns answered in the same thread by another engine
// are not in it, so before handing them a turn we tell them what was said meanwhile (text only, newest last).
import type { HarnessId, Part } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { untrusted } from "../tools/result.ts";

const MAX_TURNS = 12;
const MAX_CHARS = 12_000;

export function recapFor(store: Store, threadId: string, harness: HarnessId, currentRunId: string): string {
  const since = store.harnessSessions.updatedAt(threadId, harness);
  const runs = store.runs
    .list(threadId, 50)
    .filter((r) => r.id !== currentRunId && r.state === "completed" && r.harness !== harness)
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
