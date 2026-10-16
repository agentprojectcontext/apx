import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import { allowedTools, authorize, inherit } from "./policy.ts";
import { type Confirm, defineTool, type Effect } from "./types.ts";

const base = (name: string, effect: Effect = "none", confirm: Confirm = "never") => ({
  name,
  description: name,
  args: z.object({}),
  effect,
  confirm,
  deadlineMs: 1000,
  title: () => name,
  run: async () => "",
});
const tool = (...a: Parameters<typeof base>) => defineTool(base(...a));

const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  name: "Ann",
  role: "",
  kind: "agent",
  browser_profile: "shared",
  source: "local",
  prompt: "",
  ...over,
});

const ALL = [
  tool("browser_open", "external"),
  tool("browser_text"),
  tool("show_widget", "local"),
  tool("delegate", "message"),
  tool("read_output"),
  tool("ask_owner"),
];
const names = (a: AgentRecord) => allowedTools(a, ALL).map((t) => t.name);

test("tools: lists filter by name or group and keep the always-available tools", () => {
  assert.deepEqual(
    names(agent()),
    ALL.map((t) => t.name),
  );
  assert.deepEqual(names(agent({ tools: ["browser"] })), ["browser_open", "browser_text", "read_output", "ask_owner"]);
  assert.deepEqual(names(agent({ tools: ["Show_Widget", "agents"] })), [
    "show_widget",
    "delegate",
    "read_output",
    "ask_owner",
  ]);
});

test("tools: a list of MCP tools still restricts once they come through mcp_search and mcp_call", () => {
  const withBridge = [...ALL, tool("mcp_search"), tool("mcp_call")];
  const a = agent({ tools: ["mcp_notes_echo"] });
  assert.deepEqual(
    allowedTools(a, withBridge).map((t) => t.name),
    ["read_output", "ask_owner", "mcp_search", "mcp_call"],
  );
  // The MCP tools that join later are held to the same list, and to every caller's up the chain.
  const p = inherit(a, [agent({ id: "boss", tools: ["mcp"] })], withBridge);
  assert.equal(p.allows("mcp_notes_echo"), true);
  assert.equal(p.allows("mcp_notes_wipe"), false);
  assert.equal(
    inherit(agent(), [agent({ id: "boss", tools: ["browser"] })], withBridge).allows("mcp_notes_echo"),
    false,
  );
});

test("tools: a list naming nothing APX knows does not strip the agent of every tool", () => {
  assert.deepEqual(
    names(agent({ tools: ["Bash", "Edit"] })),
    ALL.map((t) => t.name),
  );
});

test("autonomy: ask confirms every call that changes something; total confirms nothing, not even 'always'", () => {
  const open = tool("x", "external", "untrusted");
  const read = tool("y");
  const always = tool("z", "local", "always");
  assert.equal(authorize(open, {}, agent({ autonomy: "ask" }), false).kind, "confirm");
  assert.equal(authorize(read, {}, agent({ autonomy: "ask" }), true).kind, "allow");
  assert.equal(authorize(open, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(always, {}, agent({ autonomy: "total" }), false).kind, "allow");
  assert.equal(authorize(always, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(always, {}, agent(), false).kind, "confirm");
});

test("ask-level calls wait unless the agent's autonomy is total", () => {
  const cmd = tool("cmd", "external", "ask");
  assert.equal(authorize(cmd, {}, agent(), false).kind, "confirm");
  assert.equal(authorize(cmd, {}, agent({ autonomy: "total" }), false).kind, "allow");
  assert.equal(authorize(cmd, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(cmd, {}, agent(), true).kind, "confirm");
});

test("edits: writing and commands in its folder run with outside content in the turn; sends and 'always' still wait", () => {
  const edits = agent({ autonomy: "edits" });
  const write = defineTool({ ...base("file_write", "local", "untrusted"), workspace: true });
  const command = defineTool({ ...base("shell", "local", "ask"), workspace: true });
  const destroy = defineTool({ ...base("shell", "local", "always"), workspace: true });
  const send = tool("message_contact", "message", "untrusted");
  assert.equal(authorize(write, {}, edits, true).kind, "allow");
  assert.equal(authorize(command, {}, edits, true).kind, "allow");
  assert.equal(authorize(destroy, {}, edits, false).kind, "confirm");
  assert.equal(authorize(send, {}, edits, true).kind, "confirm");
  // Standard still asks for both.
  assert.equal(authorize(write, {}, agent(), true).kind, "confirm");
  assert.equal(authorize(command, {}, agent(), false).kind, "confirm");
});

test("a delegated run takes the strictest autonomy up its chain, edits between standard and total", () => {
  const all = [tool("x")];
  assert.equal(inherit(agent({ autonomy: "total" }), [agent({ autonomy: "edits" })], all).agent.autonomy, "edits");
  assert.equal(inherit(agent({ autonomy: "edits" }), [agent()], all).agent.autonomy, "standard");
  assert.equal(inherit(agent({ autonomy: "edits" }), [agent({ autonomy: "total" })], all).agent.autonomy, "edits");
});

test("standard autonomy: high-impact calls wait only while untrusted content is in context", () => {
  const send = tool("send", "message", "untrusted");
  assert.equal(authorize(send, {}, agent(), false).kind, "allow");
  assert.equal(authorize(send, {}, agent(), true).kind, "confirm");
  assert.equal(authorize(tool("open", "external"), {}, agent(), true).kind, "allow");
});

test("rules: an agent's own rule for a risk wins over its autonomy, and off takes the tools away", () => {
  const send = tool("send_it", "message");
  const write = tool("write_it", "local", "ask");
  const wipe = tool("wipe_it", "local", "always");
  const read = tool("read_it");
  const ruled = agent({ autonomy: "total", rules: { outside: "ask", irreversible: "off", write: "auto" } });
  assert.equal(authorize(send, {}, ruled, false).kind, "confirm");
  assert.equal(authorize(wipe, {}, ruled, false).kind, "deny");
  assert.equal(authorize(write, {}, agent({ autonomy: "ask", rules: { write: "auto" } }), true).kind, "allow");
  assert.equal(authorize(read, {}, ruled, true).kind, "allow");
  assert.deepEqual(
    allowedTools(ruled, [send, wipe, read, tool("ask_owner")]).map((t) => t.name),
    ["send_it", "read_it", "ask_owner"],
  );
});

test("rules: a delegated run never gets looser rules than its own autonomy from its caller", () => {
  const caller = agent({ id: "boss", rules: { outside: "auto" } });
  const worker = agent({ id: "w", autonomy: "ask" });
  const { agent: run } = inherit(worker, [caller], []);
  assert.equal(run.rules?.outside, "ask");
  const strict = inherit(agent({ id: "w2", rules: { write: "auto" } }), [agent({ rules: { write: "off" } })], []);
  assert.equal(strict.agent.rules?.write, "off");
});
