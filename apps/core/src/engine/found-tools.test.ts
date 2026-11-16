// APX's rarely used tools are named in mcp_search instead of sent on every call, and run by name as before
// (DECISIONS.md#d-233).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("done");
  if (said === "list my routines") return callTool("r0", "routine_list", {});
  if (said === "list them through the bridge") return callTool("r1", "mcp_call", { tool: "routine_list", args: {} });
  if (said === "show a chart") return callTool("w0", "show_widget", {});
  if (said === "tasks through the bridge") return callTool("t0", "mcp_call", { tool: "task_list", args: {} });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function turn(text: string) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  const sent = await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id);
  return env.core.store.runs.steps(sent.run.id);
}

/** What the model read back from its last tool call. */
const readBack = () => String(llm.calls.at(-1)?.messages.findLast((m) => m.role === "tool")?.content ?? "");

test("a turn sends the tools most turns use, and names the rest in mcp_search", async () => {
  await turn("hello");
  const tools = llm.calls.at(-1)?.tools ?? [];
  const names = tools.map((t) => t.function.name);
  for (const rare of ["routine_set", "show_widget", "agent_set", "apx_settings"])
    assert.ok(!names.includes(rare), rare);
  for (const kept of ["shell", "delegate", "task_create", "plan", "remember"]) assert.ok(names.includes(kept), kept);
  const search = tools.find((t) => t.function.name === "mcp_search");
  const said = search?.function.description ?? "";
  for (const rare of ["routine_set", "show_widget", "agent_set", "apx_settings"])
    assert.match(said, new RegExp(`called by name like any other: [^.]*\\b${rare}\\b`));
});

test("a rarely used tool runs when called by its name, or through mcp_call", async () => {
  const [direct] = await turn("list my routines");
  assert.equal(direct?.tool, "routine_list");
  assert.equal(direct?.state, "ok");
  const [bridged] = await turn("list them through the bridge");
  assert.equal(bridged?.state, "ok");
});

test("a found tool called with wrong arguments gets its schema back for the next try", async () => {
  await turn("show a chart");
  assert.match(readBack(), /invalid arguments for show_widget[\s\S]*args: \{/);
});

test("mcp_call still runs only found tools, not the ones every turn has", async () => {
  await turn("tasks through the bridge");
  assert.match(readBack(), /unknown tool task_list/);
});
