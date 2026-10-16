import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { matchesCondition, nativeApproval } from "./approvals.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("a condition matches paths by prefix, URLs by domain, and names in a list", () => {
  assert.ok(matchesCondition("app/Http/", { path: "app/Http/Kernel.php" }));
  assert.ok(!matchesCondition("app/Http/", { path: "config/app.php" }));
  assert.ok(matchesCondition("github.com", { url: "https://api.github.com/repos" }));
  assert.ok(!matchesCondition("github.com", { url: "https://github.com.example.net/" }));
  assert.ok(matchesCondition("crm-sheets, crm-qa", { agent: "crm-qa" }));
  assert.ok(!matchesCondition("crm-qa", undefined));
});

test("a grant narrowed to a condition covers only matching calls, and one past its date covers none", async () => {
  const target = nativeApproval("file_write");
  const store = env.core.store;
  store.approvals.grant(target, "always", "t1", "ann");
  assert.ok(store.approvals.allows(target, undefined, "ann", { path: "config/app.php" }));

  const { approval } = await env.client.call("tools.grant_set", {
    key: target.key,
    agent: "ann",
    condition: "app/Http/",
  });
  assert.equal(approval.condition, "app/Http/");
  assert.equal(approval.from_thread, "t1");
  assert.ok(store.approvals.allows(target, undefined, "ann", { path: "app/Http/Kernel.php" }));
  assert.ok(!store.approvals.allows(target, undefined, "ann", { path: "config/app.php" }));

  await env.client.call("tools.grant_set", { key: target.key, agent: "ann", condition: "" });
  assert.ok(store.approvals.allows(target, undefined, "ann", { path: "config/app.php" }));

  await env.client.call("tools.grant_set", {
    key: target.key,
    agent: "ann",
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  assert.ok(!store.approvals.allows(target, undefined, "ann", { path: "config/app.php" }));
  assert.equal((await env.client.call("tools.approvals", {})).approvals.filter((g) => g.agent_id === "ann").length, 0);
});
