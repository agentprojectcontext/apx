// Agents hand work on through tasks without passing it to and fro: past a few hand-offs, or giving work back up its own
// chain, a new task is a proposal for the owner instead of starting.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { proposalReason } from "./task-work.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

function task(title: string, by: string, parent?: string) {
  const store = env.core.store;
  return store.tasks.create({
    title,
    status: "todo",
    parent_id: parent,
    thread_id: store.threads.create({ kind: "task", title, agent_ids: ["roby"] }).id,
    by,
  });
}

test("a short chain hands on freely; too deep, or back up the chain, waits for the owner", () => {
  const store = env.core.store;
  const audit = task("SEO audit", "owner");
  assert.equal(proposalReason(store, audit.id, "vera", "scout"), undefined, "the audit's findings go to marketing");
  const copy = task("Rewrite the landing copy", "scout", audit.id);
  assert.match(proposalReason(store, copy.id, "scout", "vera") ?? "", /gives work back up its own chain/);
  const check = task("Check the new copy", "vera", copy.id);
  assert.match(proposalReason(store, check.id, "omar", "nora") ?? "", /4 hand-offs deep/);
  assert.equal(proposalReason(store, copy.id, "vera", "vera"), undefined, "its own next step is not a hand-off back");
});
