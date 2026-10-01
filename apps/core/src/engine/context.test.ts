import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "../domain/threads.ts";
import type { ChatItem } from "../providers/types.ts";
import { frameInput, projectHistory, repair, systemPrompt } from "./context.ts";

const call = (id: string, name = "browser_text"): ChatItem => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
});
const entries = (runs: ChatItem[][]): LogEntry[] =>
  runs.flatMap((items, r) => items.map((item, i) => ({ seq: r * 100 + i, run_id: `run${r}`, item })));

test("the system prompt has no clock and no roster: same agent and thread, same bytes", () => {
  const agent = {
    id: "roby",
    name: "Roby",
    role: "secretary",
    kind: "secretary" as const,
    browser_profile: "shared" as const,
    prompt: "",
  };
  const a = systemPrompt(agent, { kind: "home" }, "es");
  assert.equal(a, systemPrompt(agent, { kind: "home" }, "es"));
  assert.doesNotMatch(a, /\d{4}|id: scout/);
  assert.match(a, /Spanish \(Rioplatense/);
});

test("history keeps whole runs, prunes old tool output and stays within budget", () => {
  const big = "x".repeat(5000);
  const runs: ChatItem[][] = [0, 1, 2, 3].map((i) => [
    { role: "user", content: `q${i}` },
    call(`c${i}`),
    { role: "tool", tool_call_id: `c${i}`, content: big },
    { role: "assistant", content: `a${i}` },
  ]);
  const all = projectHistory(entries(runs));
  const tool = (id: string) => all.find((m) => m.role === "tool" && m.tool_call_id === id)?.content;
  assert.equal(tool("c3"), big);
  assert.equal(tool("c2"), big);
  assert.match(String(tool("c1")), /^\[earlier output of browser_text omitted: 5000 chars/);
  // A tight budget drops the oldest runs whole, never half a run.
  const tight = projectHistory(entries(runs), 10_600);
  assert.deepEqual(
    tight.filter((m) => m.role === "user").map((m) => m.content),
    ["q2", "q3"],
  );
});

test("repair starts at a user item, drops orphan results and closes unanswered calls", () => {
  const fixed = repair([
    { role: "tool", tool_call_id: "zz", content: "orphan" },
    { role: "assistant", content: "stray" },
    { role: "user", content: "hi" },
    call("a"),
    { role: "tool", tool_call_id: "nope", content: "wrong pair" },
    { role: "user", content: "next" },
  ]);
  assert.deepEqual(fixed, [
    { role: "user", content: "hi" },
    call("a"),
    { role: "tool", tool_call_id: "a", content: "not run: the turn was interrupted" },
    { role: "user", content: "next" },
  ]);
});

test("only the owner speaks plainly; agents, widgets and results arrive as untrusted data", () => {
  assert.equal(frameInput({ kind: "user" }, "hola"), "hola");
  assert.match(
    frameInput({ kind: "surface", id: "s", title: 'Sales "Q3"' }, "buy"),
    /<widget_message from="Sales 'Q3'" trust="untrusted">/,
  );
  assert.match(
    frameInput(
      { kind: "delegation_result", agent_id: "scout", name: "Scout", thread_id: "th", run_id: "r", state: "failed" },
      "x",
    ),
    /<delegation_result from="Scout" sub_thread="th" state="failed" trust="untrusted">/,
  );
});
