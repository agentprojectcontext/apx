import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("the RPC refuses recursive follow-ups even through an elevated tool that passed its normal policy", async () => {
  const at = Date.parse("2026-10-05T10:00:00Z");
  let now = new Date(at);
  let dispatched = false;
  const elevated = defineTool({
    name: "elevated_followup",
    description: "Try an elevated follow-up",
    args: z.object({}),
    effect: "local",
    confirm: "always",
    deadlineMs: 5000,
    title: () => "Try a follow-up",
    run: async (_args, ctx) => {
      assert.ok(ctx.callAsOwner, "normal policy provided the elevated call");
      dispatched = true;
      return JSON.stringify(
        await ctx.callAsOwner("continuations.create", {
          thread: ctx.thread.id,
          purpose: "Do not rearm",
          condition: { kind: "time", at: new Date(at + 20 * 60_000).toISOString() },
          expires_at: new Date(at + 30 * 60_000).toISOString(),
        }),
      );
    },
  });
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("try", "elevated_followup", {}),
  );
  const env = await startCore({ llm, extraTools: [elevated], clock: () => now });
  try {
    await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
    await env.client.call("continuations.create", {
      thread: "home",
      purpose: "Read the report",
      condition: { kind: "time", at: new Date(at + 10 * 60_000).toISOString() },
      expires_at: new Date(at + 30 * 60_000).toISOString(),
    });
    now = new Date(at + 10 * 60_000);
    env.core.scheduler.tick();
    await env.settle("home");
    assert.equal(dispatched, true);
    assert.equal(env.core.store.continuations.list().length, 1);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /cannot schedule another follow-up/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
