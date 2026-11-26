// A new server's tools run unasked only while no outside content is in the turn; the owner's own "allow all" covers
// both (DECISIONS.md#d-279, rule 10).
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");

const llm = scriptedLlm((req, { said, afterTool }) => {
  const last = String(req.messages.at(-1)?.content);
  // An MCP tool's answer is outside content: after reading with echo, the turn carries it into token.
  if (afterTool && said.includes("read then act") && last.includes("echo:"))
    return callTool("t2", "mcp_desk_token", {});
  if (afterTool) return say(`Result: ${last.slice(0, 300)}`);
  if (said.includes("read then act")) return callTool("t1", "mcp_desk_echo", { text: "hi" });
  if (said.includes("act now")) return callTool("t1", "mcp_desk_token", {});
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  await env.client.call("mcp.set", { name: "desk", server: { command: process.execPath, args: [SERVER] } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** The owner's message in a new chat with the super-agent (Auto); what waits for the owner, or nothing once it ended. */
async function turn(text: string) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Desk" });
  await env.client.call("threads.send", { thread: t.id, text });
  const pending = await inputsOrEnd(env.client, t.id, 15_000);
  for (const p of pending) await env.client.call("runs.respond", { input: p.id, decision: "deny" });
  await env.settle(t.id, 15_000);
  return { pending, answer: String(llm.calls.at(-1)?.messages.at(-1)?.content) };
}

test("a new server's tool runs unasked in Auto when no outside content is in the turn", async () => {
  const { pending, answer } = await turn("act now");
  assert.deepEqual(pending, []);
  assert.match(answer, /token=/);
});

test("with outside content in the turn, the same tool waits for the owner's card", async () => {
  const { pending } = await turn("read then act");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.tool, "mcp_desk_token");
});

test("in Manual too, outside content keeps the card a new server's tool would otherwise skip", async () => {
  await env.client.call("agents.update", { agent: "superagent", autonomy: "manual" });
  try {
    const { pending } = await turn("read then act");
    assert.equal(pending[0]?.tool, "mcp_desk_token");
  } finally {
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
  }
});

test("once the owner allows every tool themselves, it runs unasked even with outside content", async () => {
  await env.client.call("mcp.toolMode", { scope: "global", server: "desk", mode: "all" });
  const { pending, answer } = await turn("read then act");
  assert.deepEqual(pending, []);
  assert.match(answer, /token=/);
});
