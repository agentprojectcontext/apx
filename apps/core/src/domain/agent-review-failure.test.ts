import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { pendingAgentReviews, watchAgentReviews } from "./agent-review.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

const drain = () => new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)));

test("an asynchronous detector failure is contained, logged and retried on the next team change", async () => {
  const dir = tempDir("apx-agent-review-failure-");
  const db = openDb(dir.path);
  const bus = createBus();
  const store = createStore(db, bus);
  seed(store);
  const errors: unknown[] = [];
  const stop = watchAgentReviews(store, bus, (error) => errors.push(error));
  const add = store.notifications.add;
  try {
    await drain();
    const agent = store.agents.get("scout");
    assert.ok(agent);
    store.notifications.add = () => {
      throw new Error("notice write failed asynchronously");
    };
    store.agents.upsert({ ...agent, prompt: "Changed instructions" });
    await drain();
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /notice write failed asynchronously/);
    assert.equal(pendingAgentReviews(store).length, 0);
    store.notifications.add = add;
    store.agents.upsert({ ...agent, prompt: "Changed instructions" });
    await drain();
    assert.equal(pendingAgentReviews(store).length, 1);
    assert.ok(store.notifications.hasUnread("agent", "agent-review:global"));
  } finally {
    store.notifications.add = add;
    stop();
    db.close();
    await dir.remove();
  }
});
