import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "./testkit.ts";

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

// One that keeps its card where the mode would skip it, unless the owner granted it (as copying their logins does).
const kept = defineTool({
  name: "list_secrets_kept",
  description: "test tool",
  args: z.object({}),
  effect: "local",
  confirm: "always",
  keepsCard: () => "grant",
  deadlineMs: 10_000,
  title: () => "listed",
  async run(_a, ctx) {
    if (!ctx.callAsOwner) return "no owner call";
    return `kept names: ${(await ctx.callAsOwner("secrets.list", {})).secrets.length}`;
  },
});

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (said.includes("kept")) return callTool("k1", "list_secrets_kept", {});
  if (said.includes("with ok")) return callTool("a1", "list_secrets_with_ok", {});
  return callTool("q1", "list_secrets_quietly", {});
});
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm, extraTools: [asked, unasked, kept] });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("only a tool that always asks, once the owner says yes, acts as the owner", async () => {
  const thread = (await env.client.call("threads.create", { kind: "agent", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "quietly" });
  await env.settle(thread);
  let last = (await env.client.call("threads.get", { thread })).messages.at(-1);
  assert.match(JSON.stringify(last?.parts), /refused: /);
  assert.doesNotMatch(JSON.stringify(last?.parts), /listed as the agent|had an owner call/);

  await env.client.call("threads.send", { thread, text: "with ok" });
  const pending: Array<{ id: string }> = await inputsOrEnd(env.client, thread);
  await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision: "approve" });
  await env.settle(thread);
  last = (await env.client.call("threads.get", { thread })).messages.at(-1);
  assert.match(JSON.stringify(last?.parts), /names: \d+/);
});

const pendingIn = (thread: string) =>
  waitFor(
    async () => {
      const { inputs } = await env.client.call("runs.pending", { thread });
      return inputs.length ? inputs : undefined;
    },
    "a pending input",
    { ms: 2000 },
  ).catch(() => []);

test("on total, a tool that keeps its card acts as the owner only after the card, then on the owner's grant", async () => {
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  try {
    const thread = (await env.client.call("threads.create", { kind: "agent", agent_id: "roby" })).id;
    await env.client.call("threads.send", { thread, text: "kept" });
    const [card] = await pendingIn(thread);
    assert.equal(card?.tool, "list_secrets_kept");
    await env.client.call("runs.respond", { input: card?.id ?? "", decision: "approve", scope: "always" });
    await env.settle(thread);
    assert.match(
      JSON.stringify((await env.client.call("threads.get", { thread })).messages.at(-1)?.parts),
      /kept names/,
    );

    await env.client.call("threads.send", { thread, text: "kept" });
    await env.settle(thread);
    assert.deepEqual((await env.client.call("runs.pending", { thread })).inputs, []);
    assert.match(
      JSON.stringify((await env.client.call("threads.get", { thread })).messages.at(-1)?.parts),
      /kept names/,
    );
  } finally {
    await env.client.call("agents.update", { agent: "roby", autonomy: null });
  }
});
