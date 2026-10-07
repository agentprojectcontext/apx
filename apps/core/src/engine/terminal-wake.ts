// A command an agent suggested ran in the owner's terminal and ended: that agent gets a turn to go on from it.
import type { Store } from "../domain/store.ts";
import type { CommandEnded } from "../terminal/terminals.ts";
import type { AdmitFn } from "./engine.ts";

export function wakeAfterCommand(store: Store, admit: AdmitFn, e: CommandEnded): void {
  const author = e.message ? store.messages.get(e.message)?.author : undefined;
  // Only a block an agent wrote has someone waiting for it; a command the owner typed alone does not.
  if (author?.kind !== "agent" || !e.info.command) return;
  admit({
    thread_id: e.info.thread_id,
    agent_id: author.id,
    // The owner pressed run: their own action, like answering a question (not an agent acting alone).
    trigger: "user",
    origin: {
      kind: "terminal",
      terminal_id: e.info.id,
      command: e.info.command,
      exit_code: e.info.exit_code ?? null,
    },
    text: e.output.trim() || "(no output)",
  });
}
