import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createApcSync } from "../apc/sync.ts";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { prepareFileJournal } from "../domain/agent-migration-file-journal.ts";
import { canReadChat } from "../domain/chat-access.ts";
import { createStore } from "../domain/store.ts";
import { manualTimers, tempDir } from "../testkit/platform.ts";
import { readMoveRecord, recoveryFolder, writeMoveRecord } from "./journal.ts";
import { createAgentMigration } from "./service.ts";

function fixture() {
  const dir = tempDir("apx-agent-move-");
  const home = path.join(dir.path, "home");
  const source = path.join(dir.path, "acme");
  const destination = path.join(dir.path, "northwind");
  for (const root of [source, destination]) {
    fs.mkdirSync(path.join(root, ".apx", "agents"), { recursive: true });
    fs.writeFileSync(path.join(root, ".apx", "project.json"), JSON.stringify({ name: path.basename(root) }));
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Sample project\n");
  }
  const definition = "---\nname: Researcher\nrole: Research\nparent: lead\n---\n\nKeep the exact instructions.\n";
  fs.writeFileSync(path.join(source, ".apx", "agents", "researcher.md"), definition);
  fs.writeFileSync(
    path.join(source, ".apx", "agents", "lead.md"),
    "---\nname: Lead\nrole: Editor\n---\n\nCheck reports.\n",
  );
  fs.writeFileSync(
    path.join(source, ".apx", "agents", "assistant.md"),
    "---\nname: Assistant\nrole: Assistant\nparent: researcher\n---\n\nCheck links.\n",
  );
  fs.mkdirSync(path.join(source, "reports"));
  const bytes = new Uint8Array([0, 1, 255, 2]);
  fs.writeFileSync(path.join(source, "reports", "report.bin"), bytes);
  fs.mkdirSync(home);
  const db = openDb(home);
  const store = createStore(db, createBus());
  const apc = createApcSync({
    store,
    engines: { has: () => false },
    watchTimers: manualTimers(),
    log: { info() {}, warn() {}, error() {} },
  });
  const sourceId = apc.register(source).project;
  const destinationId = apc.register(destination).project;
  const agent = store.agents.list().find((a) => a.slug === "researcher");
  const lead = store.agents.list().find((a) => a.slug === "lead");
  assert.ok(agent && lead);
  const service = createAgentMigration({ store, home, apc });
  return {
    dir,
    db,
    store,
    apc,
    service,
    home,
    source,
    destination,
    sourceId,
    destinationId,
    agent,
    lead,
    bytes,
    definition,
    async close() {
      apc.close();
      if (db.isOpen) db.close();
      await dir.remove();
    },
  };
}

test("a move preserves identity, exact instructions, shared completed work and binary files, then recovers without loss", async () => {
  const env = fixture();
  const { store, service, agent, lead } = env;
  try {
    const chat = store.threads.create({
      kind: "task",
      title: "Shared report",
      project_id: env.sourceId,
      agent_ids: [lead.id],
    });
    const task = store.tasks.create({
      title: "Check report",
      status: "doing",
      project_id: env.sourceId,
      assignee: lead.id,
      thread_id: chat.id,
      by: "owner",
    });
    const delegated = store.threads.create({
      kind: "agent",
      title: "Research",
      project_id: env.sourceId,
      agent_ids: [agent.id],
      parent_id: chat.id,
      task_id: task.id,
    });
    store.tasks.change(task.id, { state: "done" }, "owner");
    const note = store.memories.add({
      scope: "agent",
      agent_id: agent.id,
      project_id: env.sourceId,
      text: "Check citations",
      source: "owner",
      thread_id: delegated.id,
    });
    const input = { agent: agent.id, destination: env.destinationId, paths: ["reports"] };
    const preview = service.preview(input);
    assert.deepEqual(preview.blockers, []);
    assert.ok(preview.shared_tasks.includes(task.id));
    assert.equal(fs.existsSync(path.join(env.source, "reports", "report.bin")), true);
    const moved = service.move({ ...input, id: preview.id, revision: preview.revision });
    assert.equal(moved.state, "committed");
    assert.equal(store.agents.get(agent.id)?.project_id, env.destinationId);
    assert.equal(store.agents.get(agent.id)?.prompt, agent.prompt);
    assert.equal(store.agents.get(agent.id)?.parent, undefined);
    assert.equal(store.tasks.get(task.id)?.state, "done");
    assert.equal(store.tasks.get(task.id)?.project_id, env.destinationId);
    assert.equal(store.memories.get(note.id)?.project_id, env.destinationId);
    assert.equal(fs.existsSync(path.join(env.source, ".apx", "agents", "researcher.md")), false);
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(env.destination, "reports", "report.bin"))), env.bytes);
    assert.equal(fs.existsSync(path.join(env.source, "reports", "report.bin")), false);
    assert.equal(store.agents.list().filter((a) => a.slug === "researcher").length, 1);
    const movedChat = store.threads.get(chat.id);
    assert.ok(movedChat);
    assert.equal(canReadChat(store, lead, movedChat), false);
    apcReindex(env);
    assert.equal(store.agents.get(agent.id)?.project_id, env.destinationId);
    assert.deepEqual(service.move({ ...input, id: preview.id, revision: preview.revision }), moved);
    assert.throws(() => service.move({ ...input, id: preview.id, revision: "changed" }), /different request/);
    assert.throws(
      () => service.move({ ...input, paths: [], id: preview.id, revision: preview.revision }),
      /different request/,
    );
    assert.deepEqual(service.recover(preview.id), { id: preview.id, restored: true });
    assert.equal(store.agents.get(agent.id)?.project_id, env.sourceId);
    assert.equal(store.tasks.get(task.id)?.assignee, lead.id);
    assert.equal(fs.readFileSync(path.join(env.source, ".apx", "agents", "researcher.md"), "utf8"), env.definition);
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(env.source, "reports", "report.bin"))), env.bytes);
    assert.equal(fs.existsSync(path.join(env.destination, "reports", "report.bin")), false);
    assert.equal(store.agentMigrationPending.list().length, 0);
    assert.deepEqual(service.recover(preview.id), { id: preview.id, restored: true });
    const retried = service.preview(input);
    assert.equal(service.move({ ...input, id: retried.id, revision: retried.revision }).state, "committed");
    assert.deepEqual(service.recover(retried.id), { id: retried.id, restored: true });
  } finally {
    await env.close();
  }
});

for (const stage of ["before-staging", "partial-first-group", "between-groups"] as const) {
  test(`preparation interrupted ${stage} recovers after reopening without requiring complete file journals`, async () => {
    const env = fixture();
    try {
      const input = { agent: env.agent.id, destination: env.destinationId, paths: ["reports"] };
      const preview = env.service.preview(input);
      writeMoveRecord(env.home, {
        id: preview.id,
        agent: env.agent.id,
        source: env.sourceId,
        destination: env.destinationId,
        source_root: env.source,
        destination_root: env.destination,
        revision: preview.revision,
        paths: preview.paths,
        threads: preview.threads,
        journals: ["work", "artifacts"],
        state: "preparing",
      });
      const folder = recoveryFolder(env.home, preview.id);
      assert.equal(fs.existsSync(folder), false, "the recovery record precedes all staging folders");
      if (stage !== "before-staging") {
        const work = prepareFileJournal(path.join(folder, "work"), preview.id, env.source, env.destination);
        work.change("source", "reports/report.bin", null);
        if (stage === "between-groups") {
          work.persist();
          const artifacts = prepareFileJournal(path.join(folder, "artifacts"), preview.id, env.source, env.destination);
          artifacts.change("destination", "staged.txt", new TextEncoder().encode("Example staging"));
        }
      }
      assert.throws(() => env.service.move({ ...input, id: preview.id, revision: preview.revision }), /Recover/);
      env.apc.close();
      env.db.close();
      const db = openDb(env.home);
      const store = createStore(db, createBus());
      const apc = createApcSync({
        store,
        engines: { has: () => false },
        watchTimers: manualTimers(),
        log: { info() {}, warn() {}, error() {} },
      });
      try {
        const restarted = createAgentMigration({ store, home: env.home, apc });
        assert.deepEqual(restarted.recoverInterrupted(), [{ id: preview.id, state: "restored" }]);
        assert.deepEqual(restarted.recover(preview.id), { id: preview.id, restored: true });
        assert.equal(readMoveRecord(env.home, preview.id).state, "restored");
        assert.equal(store.agents.get(env.agent.id)?.project_id, env.sourceId);
        assert.equal(fs.readFileSync(path.join(env.source, ".apx", "agents", "researcher.md"), "utf8"), env.definition);
        assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(env.source, "reports", "report.bin"))), env.bytes);
        assert.equal(fs.existsSync(path.join(env.destination, "reports", "report.bin")), false);
        assert.equal(store.agentMigrationPending.list().length, 0);
        assert.deepEqual(restarted.recoverInterrupted(), []);
        const retry = restarted.preview(input);
        assert.equal(restarted.move({ ...input, id: retry.id, revision: retry.revision }).state, "committed");
      } finally {
        apc.close();
        db.close();
      }
    } finally {
      await env.close();
    }
  });
}

function apcReindex(env: ReturnType<typeof fixture>) {
  env.apc.sync();
  assert.equal(env.store.agents.list().filter((a) => a.slug === "researcher").length, 1);
}

test("reindex failure rolls back the database and files; an interrupted rollback survives reopening", async () => {
  const env = fixture();
  try {
    const input = { agent: env.agent.id, destination: env.destinationId, paths: ["reports"] };
    const preview = env.service.preview(input);
    const broken = createAgentMigration({
      store: env.store,
      home: env.home,
      apc: {
        invalidate: env.apc.invalidate,
        sync() {
          throw new Error("Reindex unavailable");
        },
      },
    });
    assert.throws(() => broken.move({ ...input, id: preview.id, revision: preview.revision }), /needs recovery/);
    assert.equal(env.store.agents.get(env.agent.id)?.project_id, env.sourceId);
    assert.equal(fs.existsSync(path.join(env.destination, "reports", "report.bin")), false);
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(env.source, "reports", "report.bin"))), env.bytes);
    assert.equal(env.store.agentMigrationPending.list().length, 1);
    assert.equal(env.apc.sync().projects, 0, "watchers cannot create a duplicate identity while recovery is pending");
    env.apc.close();
    env.db.close();
    const db = openDb(env.home);
    const store = createStore(db, createBus());
    const apc = createApcSync({
      store,
      engines: { has: () => false },
      watchTimers: manualTimers(),
      log: { info() {}, warn() {}, error() {} },
    });
    try {
      const restarted = createAgentMigration({ store, home: env.home, apc });
      assert.equal(apc.sync().projects, 0);
      assert.deepEqual(restarted.recoverInterrupted(), [{ id: preview.id, state: "restored" }]);
      assert.equal(store.agentMigrationPending.list().length, 0);
      assert.equal(store.agents.list().filter((a) => a.slug === "researcher").length, 1);
      assert.equal(store.agents.get(env.agent.id)?.project_id, env.sourceId);
      assert.equal(fs.readFileSync(path.join(env.source, ".apx", "agents", "researcher.md"), "utf8"), env.definition);
      assert.deepEqual(restarted.recoverInterrupted(), []);
    } finally {
      apc.close();
      db.close();
    }
  } finally {
    await env.close();
  }
});

test("new work outside the old inventory prevents recovery and is preserved", async () => {
  for (const kind of ["thread", "memory"] as const) {
    const env = fixture();
    try {
      const input = { agent: env.agent.id, destination: env.destinationId, paths: ["reports"] };
      const preview = env.service.preview(input);
      env.service.move({ ...input, id: preview.id, revision: preview.revision });
      if (kind === "thread")
        env.store.threads.create({
          kind: "agent",
          title: "New report",
          project_id: env.destinationId,
          agent_ids: [env.agent.id],
        });
      else
        env.store.memories.add({
          scope: "agent",
          project_id: env.destinationId,
          agent_id: env.agent.id,
          text: "A new checklist",
          source: "owner",
        });
      assert.throws(() => env.service.recover(preview.id), /Work changed/);
      assert.equal(env.store.agents.get(env.agent.id)?.project_id, env.destinationId);
      assert.equal(fs.existsSync(path.join(env.destination, "reports", "report.bin")), true);
      assert.equal(env.store.agentMigrationPending.list().length, 0);
    } finally {
      await env.close();
    }
  }
});

test("active source work blocks migration instead of retaining an in-flight source context", async () => {
  const env = fixture();
  try {
    const thread = env.store.threads.create({
      kind: "agent",
      title: "Other work",
      project_id: env.sourceId,
      agent_ids: [env.lead.id],
    });
    env.store.runs.create({
      thread_id: thread.id,
      agent_id: env.lead.id,
      trigger: "user",
      input: { text: "Check a report", origin: { kind: "user" } },
      deadline_at: "2099-01-01T00:00:00.000Z",
    });
    const preview = env.service.preview({ agent: env.agent.id, destination: env.destinationId, paths: [] });
    assert.ok(preview.blockers.includes("active_source_work"));
    assert.throws(
      () =>
        env.service.move({
          agent: env.agent.id,
          destination: env.destinationId,
          paths: [],
          id: preview.id,
          revision: preview.revision,
        }),
      /not ready/,
    );
    assert.equal(env.store.agents.get(env.agent.id)?.project_id, env.sourceId);
  } finally {
    await env.close();
  }
});

test("stale previews and recovery after newer file or database work never overwrite it", async () => {
  const env = fixture();
  try {
    const input = { agent: env.agent.id, destination: env.destinationId, paths: ["reports"] };
    const before = env.service.preview(input);
    fs.writeFileSync(path.join(env.source, "reports", "report.bin"), "Changed before move");
    assert.throws(() => env.service.move({ ...input, id: before.id, revision: before.revision }), /work changed/);
    assert.equal(env.store.agents.get(env.agent.id)?.project_id, env.sourceId);
    const current = env.service.preview(input);
    env.service.move({ ...input, id: current.id, revision: current.revision });
    fs.writeFileSync(path.join(env.destination, "reports", "report.bin"), "New owner work");
    assert.throws(() => env.service.recover(current.id), /changed/);
    assert.equal(fs.readFileSync(path.join(env.destination, "reports", "report.bin"), "utf8"), "New owner work");
    assert.equal(env.store.agents.get(env.agent.id)?.project_id, env.destinationId);
    assert.equal(env.store.agentMigrationPending.list().length, 0, "a refused recovery creates no lock");
  } finally {
    await env.close();
  }
});
