import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { WORK } from "./settings-work.ts";

test("the super-agent reads past reviews with each proposal's outcome and link; project agents do not", async () => {
  const dir = tempDir("apx-review-settings-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  try {
    const read = WORK["activity_review.history"]?.read;
    const secretary = store.agents.get("superagent");
    assert.ok(read && secretary);
    const deps = { store, profiles: [], templates: [] };
    assert.match(read({}, deps, { agent: secretary }), /No reviews/);
    const thread = store.threads.create({ kind: "task", title: "Keep criteria visible", agent_ids: ["superagent"] });
    const task = store.tasks.create({
      title: "Keep acceptance criteria visible",
      thread_id: thread.id,
      proposed: true,
      status: "backlog",
      tags: ["Activity review"],
      by: "superagent",
    });
    const run = store.activityReviewRuns.start({
      at: "2030-05-02T12:00:00.000Z",
      since: "2030-04-25T12:00:00.000Z",
      chats: 12,
      messages: 30,
    });
    store.activityReviewRuns.finish(run, "completed", [{ task: task.id, title: task.title }]);
    store.activityReviewRuns.finish(
      store.activityReviewRuns.start({
        at: "2030-05-03T12:00:00.000Z",
        since: "2030-05-02T12:00:00.000Z",
        chats: 1,
        messages: 1,
      }),
      "completed",
    );
    const text = read({ limit: 1 }, deps, { agent: secretary });
    assert.match(text, /^2030-05-03T12:00:00.000Z · completed · 1 chats/);
    assert.match(text, /- no proposals/);
    assert.match(text, /More: before=2030-05-03T12:00:00.000Z/);
    const older = read({ before: "2030-05-03T12:00:00.000Z" }, deps, { agent: secretary });
    assert.match(older, /12 chats, 30 owner messages since 2030-04-25/);
    assert.match(older, new RegExp(`- pending: "Keep acceptance criteria visible" \\(apx:tasks/${task.id}\\)`));
    const other = { ...secretary, id: "other-agent", kind: "agent" as const, project_id: "northwind" };
    assert.doesNotMatch(read({}, deps, { agent: other }), /Keep acceptance/);
    assert.doesNotMatch(read({}, deps), /Keep acceptance/);
  } finally {
    db.close();
    await dir.remove();
  }
});
