import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Two tools reach an owner-only method (secrets.list): one that always needs the owner's OK, one that does not.
const asked = defineTool({
  name: "list_secrets_with_ok",
  description: "test tool",
  args: z.object({}),
  effect: "local",
  confirm: "always",
  deadlineMs: 10_000,
  title: () => "listed",
  async run(_a, ctx) {
    if (!ctx.callAsOwner) return "no owner call";
    return `names: ${(await ctx.callAsOwner("secrets.list", {})).secrets.length}`;
  },
});
const unasked = defineTool({
  name: "list_secrets_quietly",
  description: "test tool",
  args: z.object({}),
  effect: "none",
  deadlineMs: 10_000,
  title: () => "listed",
  async run(_a, ctx) {
    if (ctx.callAsOwner) return "had an owner call";
    try {
      await ctx.call("secrets.list", {});
      return "listed as the agent";
    } catch (err) {
      return `refused: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (said.includes("with ok")) return callTool("a1", "list_secrets_with_ok", {});
  return callTool("q1", "list_secrets_quietly", {});
});
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm, extraTools: [asked, unasked] });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("only a tool that always asks, once the owner says yes, acts as the owner", async () => {
  const thread = (await env.client.call("threads.create", { kind: "agent", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "quietly" });
  await env.settle(thread);
  let last = (await env.client.call("threads.get", { thread })).messages.at(-1);
  assert.match(JSON.stringify(last?.parts), /refused: /);
  assert.doesNotMatch(JSON.stringify(last?.parts), /listed as the agent|had an owner call/);

  await env.client.call("threads.send", { thread, text: "with ok" });
  let pending: Array<{ id: string }> = [];
  for (let i = 0; i < 80 && !pending.length; i++) {
    pending = (await env.client.call("runs.pending", { thread })).inputs;
    if (!pending.length) await new Promise((r) => setTimeout(r, 25));
  }
  await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision: "approve" });
  await env.settle(thread);
  last = (await env.client.call("threads.get", { thread })).messages.at(-1);
  assert.match(JSON.stringify(last?.parts), /names: \d+/);
});
