import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

// These use a running, isolated core with its own secret store; no Google account or owner's daemon is touched.
test("the account is optional, sign-out is offline, and agents cannot inspect or change it", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    assert.equal((await env.client.call("account.get", {})).profile, null);
    assert.deepEqual(await env.client.call("account.logout", {}), { ok: true });
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    for (const [method, params] of [
      ["account.get", {}],
      ["account.start", {}],
      ["account.finish", { code: "code", state: "state" }],
      ["account.rename", { handle: "acme" }],
      ["account.logout", {}],
    ] as const) {
      await assert.rejects(agent.call(method, params), /reserved to the owner/);
    }
    await assert.rejects(env.client.call("account.finish", { code: "code", state: "forged-state" }), /sign_in_expired/);
    assert.equal((await env.client.call("account.get", {})).profile, null);
    assert.equal((await env.client.call("owner.get", {})).name, "");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
