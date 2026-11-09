// A store on its own (no engine) with one agent, for the office clock's lanes: what it starts or asks to go on.
import type { TestContext } from "node:test";
import type { Task } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import type { AdmitFn } from "./engine.ts";

export const AGENT = "worker";
/** Older than any activity the fixture creates. */
export const LONG_AGO = "2020-01-01T00:00:00.000Z";

export function laneFixture(t: TestContext) {
  const temp = tempDir("apx-task-lanes-");
  let db = openDb(temp.path);
  let store = createStore(db, createBus());
  t.after(async () => {
    db.close();
    await temp.remove();
  });
  store.agents.upsert({ id: AGENT, name: "Worker", role: "Developer", kind: "agent", browser_profile: "isolated" });
  const admitted: Array<{ thread_id: string; trigger: string; origin?: { kind: string } }> = [];
  /** Admits like the engine would: a run that ends at once without closing the task. */
  const admit: AdmitFn = (a) => {
    admitted.push(a);
    const run = store.runs.create({
      ...a,
      input: { origin: a.origin, text: a.text },
      deadline_at: "2099-01-01T00:00:00.000Z",
    });
    return store.runs.setState(run, "completed");
  };
  return {
    get store() {
      return store;
    },
    admitted,
    admit,
    create(options: Partial<Task> = {}): Task {
      return store.tasks.create({
        title: "Pending work",
        description: "Implement the requested change.",
        status: "todo",
        priority: "normal",
        assignee: AGENT,
        ...options,
        thread_id: store.threads.create({ kind: "task", title: "Pending work", agent_ids: [] }).id,
        by: "owner",
      });
    },
    /** Many open tasks nobody can start, all more recently active than anything made before. */
    crowd(count: number) {
      store.tx(() => {
        for (let i = 0; i < count; i++)
          store.tasks.create({
            title: `Note ${i}`,
            status: "todo",
            priority: "normal",
            thread_id: store.threads.create({ kind: "task", title: `Note ${i}`, agent_ids: [] }).id,
            by: "owner",
          });
      });
    },
    /** Makes a task the least recently active on the board. */
    age(id: string) {
      db.prepare("UPDATE tasks SET activity_at = ? WHERE id = ?").run(LONG_AGO, id);
    },
    /** Makes a task's assignment older than any pickup window. */
    assignedLongAgo(id: string) {
      db.prepare("UPDATE task_events SET at = ? WHERE task_id = ?").run(LONG_AGO, id);
    },
    /** A task in progress whose agent's last turn just ended. */
    worked(options: Partial<Task> = {}): Task {
      const task = this.create({ status: "doing", ...options });
      const chat = store.threads.create({ kind: "loose", title: task.title, agent_ids: [AGENT], task_id: task.id });
      const run = store.runs.create({
        thread_id: chat.id,
        agent_id: AGENT,
        trigger: "user",
        input: { origin: { kind: "user" }, text: "Work on this task." },
        deadline_at: "2099-01-01T00:00:00.000Z",
      });
      store.runs.setState(run, "completed");
      return task;
    },
    /** The same database opened again, as after a restart. */
    reopen() {
      db.close();
      db = openDb(temp.path);
      store = createStore(db, createBus());
    },
  };
}
