import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import { allowedTools, authorize } from "./policy.ts";
import { type Confirm, defineTool, type Effect } from "./types.ts";

const tool = (name: string, effect: Effect = "none", confirm: Confirm = "never") =>
  defineTool({
    name,
    description: name,
    args: z.object({}),
    effect,
    confirm,
    deadlineMs: 1000,
    title: () => name,
    run: async () => "",
  });

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

test("tools: a list naming nothing APX knows does not strip the agent of every tool", () => {
  assert.deepEqual(
    names(agent({ tools: ["Bash", "Edit"] })),
    ALL.map((t) => t.name),
  );
});

test("autonomy: ask confirms every call that changes something; total confirms only 'always'", () => {
  const open = tool("x", "external", "untrusted");
  const read = tool("y");
  const always = tool("z", "local", "always");
  assert.equal(authorize(open, {}, agent({ autonomy: "ask" }), false).kind, "confirm");
  assert.equal(authorize(read, {}, agent({ autonomy: "ask" }), true).kind, "allow");
  assert.equal(authorize(open, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(always, {}, agent({ autonomy: "total" }), false).kind, "confirm");
});

test("ask-level calls wait unless the agent's autonomy is total", () => {
  const cmd = tool("cmd", "external", "ask");
  assert.equal(authorize(cmd, {}, agent(), false).kind, "confirm");
  assert.equal(authorize(cmd, {}, agent({ autonomy: "total" }), false).kind, "allow");
  assert.equal(authorize(cmd, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(cmd, {}, agent(), true).kind, "confirm");
});

test("standard autonomy: high-impact calls wait only while untrusted content is in context", () => {
  const send = tool("send", "message", "untrusted");
  assert.equal(authorize(send, {}, agent(), false).kind, "allow");
  assert.equal(authorize(send, {}, agent(), true).kind, "confirm");
  assert.equal(authorize(tool("open", "external"), {}, agent(), true).kind, "allow");
});
