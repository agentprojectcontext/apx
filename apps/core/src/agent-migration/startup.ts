import fs from "node:fs";
import type { Store } from "../domain/store.ts";
import { type MoveRecord, readMoveRecord, recoveryRoot } from "./journal.ts";

type Recovery = {
  finish(record: MoveRecord): void;
  unwind(record: MoveRecord): unknown;
};
export function recoverInterruptedMoves(home: string, store: Store, recovery: Recovery) {
  const root = recoveryRoot(home);
  const results: Array<{ id: string; state: "committed" | "restored" | "needs_recovery" }> = [];
  if (!fs.existsSync(root)) return results;
  for (const file of fs.readdirSync(root)) {
    const match = /^([0-9a-f-]{36})\.json$/.exec(file);
    if (!match) continue;
    const id = match[1];
    if (!id) continue;
    try {
      const record = readMoveRecord(home, id);
      if (record.state === "restored" || record.state === "committed") continue;
      if (store.agentMigration.receipt(id)?.state === "committed" && record.state !== "recovering") {
        recovery.finish(record);
        results.push({ id, state: "committed" });
      } else {
        recovery.unwind(record);
        results.push({ id, state: "restored" });
      }
    } catch {
      results.push({ id, state: "needs_recovery" });
    }
  }
  return results;
}
