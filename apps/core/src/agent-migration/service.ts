import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApcSync } from "../apc/sync.ts";
import {
  applyFileJournal,
  checkFileJournal,
  commitFileJournal,
  prepareFileJournal,
} from "../domain/agent-migration-file-journal.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict } from "../errors.ts";
import {
  type MoveRecord,
  moveRecordPath,
  readMoveJournals,
  readMoveRecord,
  recoveryFolder,
  writeMoveRecord,
} from "./journal.ts";
import { buildMigrationPlan, type MoveInput } from "./plan.ts";
import { recoverInterruptedMoves } from "./startup.ts";

type Deps = {
  store: Store;
  home: string;
  apc: Pick<ApcSync, "sync" | "invalidate">;
  bindings?: (project: string) => import("./bindings.ts").MigrationBindings;
};
export function createAgentMigration({ store, home, apc, bindings }: Deps) {
  function sync(record: MoveRecord) {
    for (const id of [record.source, record.destination]) {
      if (apc.sync(id).projects !== 1) throw badRequest("A project definition could not be reindexed");
    }
  }
  function unwind(record: MoveRecord) {
    const receipt = store.agentMigration.receipt(record.id);
    if (receipt?.state === "restored" || (!receipt && record.state === "preparing") || record.state === "restored") {
      writeMoveRecord(home, { ...record, state: "restored" });
      store.agentMigrationPending.release(record.id);
      return { id: record.id, restored: true as const };
    }
    if (receipt) store.agentMigration.checkRestore(record.id);
    const journals = readMoveJournals(home, record);
    for (const item of journals) checkFileJournal(item.folder, item.journal, true);
    apc.invalidate([record.source, record.destination]);
    store.agentMigrationPending.reserve(record);
    writeMoveRecord(home, { ...record, state: "recovering" });
    for (const item of journals.toReversed()) applyFileJournal(item.folder, item.journal, true);
    store.tx(() => {
      if (receipt) store.agentMigration.restore(record.id);
      store.agentMigrationPending.release(record.id);
      sync(record);
    });
    writeMoveRecord(home, { ...record, state: "restored" });
    return { id: record.id, restored: true as const };
  }
  function finish(record: MoveRecord) {
    for (const item of readMoveJournals(home, record)) commitFileJournal(item.folder, item.journal);
    writeMoveRecord(home, { ...record, state: "committed" });
    store.agentMigrationPending.release(record.id);
  }
  function move(input: MoveInput & { id: string; revision: string }) {
    const existing = store.agentMigration.receipt(input.id);
    if (existing) {
      if (
        existing.inventory.agent !== input.agent ||
        existing.inventory.destination !== input.destination ||
        existing.state !== "committed"
      )
        throw badRequest("This move identifier has already been used");
      const record = readMoveRecord(home, input.id);
      if (
        record.revision !== input.revision ||
        JSON.stringify(record.paths) !== JSON.stringify([...new Set(input.paths)].sort())
      )
        throw badRequest("This move identifier has already been used for a different request");
      if (record.state === "recovering") throw conflict("Finish recovering this move before continuing");
      finish(record);
      return existing;
    }
    const folder = recoveryFolder(home, input.id);
    if (fs.existsSync(folder) || fs.existsSync(moveRecordPath(home, input.id)))
      throw conflict("Recover the interrupted move before trying again");
    const plan = buildMigrationPlan(store, home, input, bindings);
    if (input.revision !== plan.preview.revision) throw conflict("The work changed; review the move again");
    if (plan.preview.blockers.length)
      throw badRequest("This work is not ready to move", { blockers: plan.preview.blockers });
    const record: MoveRecord = {
      id: input.id,
      agent: input.agent,
      source: plan.inventory.source,
      destination: input.destination,
      source_root: plan.preview.source_root,
      destination_root: plan.preview.destination_root,
      revision: input.revision,
      paths: plan.preview.paths,
      threads: plan.inventory.threads,
      journals: plan.groups.map((g) => g.name as MoveRecord["journals"][number]),
      state: "preparing",
    };
    writeMoveRecord(home, record);
    try {
      for (const group of plan.groups) {
        const journal = prepareFileJournal(path.join(folder, group.name), input.id, group.source, group.destination);
        for (const change of group.changes) journal.change(change.root, change.relative, change.after, change.mode);
        journal.persist();
      }
      record.state = "applying";
      writeMoveRecord(home, record);
      apc.invalidate([record.source, record.destination]);
      store.agentMigrationPending.reserve(record);
      if (buildMigrationPlan(store, home, input, bindings).preview.revision !== input.revision)
        throw conflict("The work changed while preparing the move; review it again");
      for (const item of readMoveJournals(home, record)) checkFileJournal(item.folder, item.journal);
      for (const item of readMoveJournals(home, record)) applyFileJournal(item.folder, item.journal);
      store.tx(() => {
        store.agentMigration.commit(plan.inventory, input.id);
        store.agentMigrationPending.release(input.id);
        sync(record);
        if (store.agents.get(input.agent)?.project_id !== input.destination || !store.agents.active(input.agent))
          throw badRequest("The agent's identity could not be preserved");
        store.agentMigration.seal(input.id);
      });
      finish(record);
      const result = store.agentMigration.receipt(input.id);
      if (!result) throw badRequest("The move has no completion record");
      return result;
    } catch (error) {
      if (store.agentMigration.receipt(input.id)?.state === "committed")
        throw conflict("The move completed, but its recovery journal still needs to be finalized", {
          migration: input.id,
        });
      try {
        unwind(record);
      } catch {
        throw conflict("The interrupted move needs recovery before this work can continue", { migration: input.id });
      }
      throw error;
    }
  }
  return {
    preview(input: MoveInput) {
      return { ...buildMigrationPlan(store, home, input, bindings).preview, id: randomUUID() };
    },
    move,
    recover(id: string) {
      return unwind(readMoveRecord(home, id));
    },
    recoverInterrupted() {
      return recoverInterruptedMoves(home, store, { finish, unwind });
    },
  };
}
export type AgentMigration = ReturnType<typeof createAgentMigration>;
