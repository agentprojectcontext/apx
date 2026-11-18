import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createRouter, type Handlers } from "./router.ts";

test("account authorization start and finish reject nonlocal callers before entering a handler", async () => {
  let entered = false;
  const refuse = () => {
    entered = true;
    throw new Error("unexpected handler");
  };
  const dispatch = createRouter({ "account.start": refuse, "account.finish": refuse } as Partial<Handlers> as Handlers);
  for (const [method, params] of [
    ["account.start", {}],
    ["account.finish", { code: "code", state: "state" }],
    ["account.finish", { error: "access_denied", state: "state" }],
  ] as const) {
    const result = await dispatch(
      method,
      params,
      {
        role: "operator",
        actor: "human",
        transport: "http",
        session: undefined,
        log: createLog("test", true),
        local: false,
      },
      "key",
    );
    assert.deepEqual(result, {
      ok: false,
      error: { code: "unauthorized", message: `${method} requires a direct local connection` },
    });
  }
  assert.equal(entered, false);
});

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
