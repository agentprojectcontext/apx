import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { acknowledgeAgentReview, agentRevision, pendingAgentReviews, watchAgentReviews } from "./agent-review.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

const drain = () => new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)));

test("all writers converge, burst notices replace, no-ops stay silent and reviews survive restart", async () => {
  const dir = tempDir("apx-agent-review-");
  const db = openDb(dir.path);
  const bus = createBus();
  const store = createStore(db, bus);
  seed(store);
  let stop = watchAgentReviews(store, bus);
  try {
    await drain();
    assert.deepEqual(pendingAgentReviews(store), []);
    store.projects.upsert({ id: "acme", name: "Acme", context: "Destination rules" });
    for (const id of ["one", "two"])
      store.agents.upsert({
        id,
        name: id,
        role: "Research",
        kind: "agent",
        project_id: "acme",
        browser_profile: "isolated",
        prompt: "Find evidence",
      });
    await drain();
    assert.equal(pendingAgentReviews(store, "acme").length, 2);
    assert.equal(pendingAgentReviews(store, "other").length, 0);
    const notices = () =>
      store.notifications.list({ unreadOnly: true, limit: 100 }).filter((n) => n.ref?.startsWith("agent-review:"));
    assert.equal(notices().length, 1);
    const first = notices()[0]?.id;
    const one = store.agents.get("one");
    assert.ok(one);
    store.agents.upsert(one);
    await drain();
    assert.equal(notices()[0]?.id, first);
    stop();
    stop = watchAgentReviews(store, bus);
    assert.equal(pendingAgentReviews(store).length, 2);
    assert.equal(notices()[0]?.id, first);
    acknowledgeAgentReview(store, one);
    const two = store.agents.get("two");
    assert.ok(two);
    acknowledgeAgentReview(store, two);
    assert.equal(notices().length, 0);
    store.agents.upsert({ ...one, model_choice: { model: "fake/model", router: false } });
    await drain();
    assert.equal(pendingAgentReviews(store).length, 0, "model-only changes need no prompt review");
    const before = agentRevision(store, one);
    store.projects.upsert({ id: "acme", name: "Acme", context: "Changed destination rules" });
    await drain();
    assert.notEqual(agentRevision(store, one), before);
    assert.equal(pendingAgentReviews(store).length, 2);
    store.agents.archive("one");
    store.agents.archive("two");
    await drain();
    assert.equal(pendingAgentReviews(store).length, 0);
    assert.equal(notices().length, 0);
  } finally {
    stop();
    db.close();
    await dir.remove();
  }
});
