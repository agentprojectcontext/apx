// The built-in loop's limits: a browser session looks again as often as it needs and gets more steps than a plain
// turn; the same call with the same result three times is still stuck.
import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm } from "../engine/testkit.ts";
import type { ChatItem } from "../providers/types.ts";
import { MAX_STEPS, nativeHarness } from "./native.ts";
import type { TurnIO } from "./types.ts";

const toolResults = (messages: ChatItem[]) => messages.filter((m) => m.role === "tool").length;
const notes = (messages: ChatItem[]) =>
  messages.filter((m) => m.role === "user" && String(m.content).startsWith("<system_note>")).map((m) => m.content);

/** One turn of the native loop, with tools answered by `answer` and nothing else around it. */
async function turn(
  next: (done: number) => ReturnType<typeof say>,
  answer: (name: string, args: Record<string, unknown>) => string = () => "ok",
) {
  // Like a real model: with the tools taken away, it can only answer.
  const llm = scriptedLlm((req) => (req.tools.length ? next(toolResults(req.messages)) : say("no tools left")));
  const ran: string[] = [];
  const io = {
    system: "system",
    history: [],
    input: { role: "user", content: "go" },
    tools: [{ type: "function", function: { name: "any", description: "", parameters: {} } }],
    models: ["fake/fake-1"],
    signal: new AbortController().signal,
    thread: { id: "t1" },
    onText() {},
    log() {},
    async execute(_id: string, name: string, args: Record<string, unknown>) {
      ran.push(name);
      return { ok: true, text: answer(name, args) };
    },
  } as unknown as TurnIO;
  const out = await nativeHarness(llm).run(io);
  return { out, ran, seen: llm.calls.at(-1)?.messages ?? [] };
}

test("a browser session can look at the page again and again, past a plain turn's steps", async () => {
  // Look, act, look again: 40 tool calls, a third of them the same snapshot.
  const { out, ran, seen } = await turn((done) => {
    if (done >= 40) return say("sent all three");
    if (done % 3 === 0) return callTool(`s${done}`, "browser_snapshot", { tab: "t1" });
    return callTool(`c${done}`, "browser_click", { tab: "t1", ref: `e${done}` });
  });
  assert.equal(out.text, "sent all three");
  assert.equal(ran.length, 40);
  assert.deepEqual(notes(seen), [], "never told it was stuck or out of steps");
});

test("reading the same page part is stuck only while it says the same", async () => {
  let page = 0;
  const changing = await turn(
    (done) => (done >= 5 ? say("read it") : callTool(`r${done}`, "browser_text", { tab: "t1" })),
    () => `page ${page++}`,
  );
  assert.equal(changing.ran.length, 5);
  assert.deepEqual(notes(changing.seen), []);

  const same = await turn((done) => (done >= 5 ? say("read it") : callTool(`r${done}`, "browser_text", { tab: "t1" })));
  assert.equal(same.ran.length, 3, "tools go off after the third identical read");
  assert.match(String(notes(same.seen)[0]), /browser_text with the same arguments 3 times/);
});

test("a turn without the browser or the screen still ends at its own step limit", async () => {
  const { ran, seen } = await turn((done) => callTool(`m${done}`, "memory_search", { query: `q${done}` }));
  assert.equal(ran.length, MAX_STEPS);
  assert.equal(MAX_STEPS, 150, "room for a long code change and its review in one turn (DECISIONS.md#d-116)");
  assert.match(String(notes(seen).at(-1)), /ran out of steps/);
});

test("a turn given more steps uses them before it must answer", async () => {
  const llm = scriptedLlm((req) =>
    req.tools.length
      ? callTool(`m${req.messages.length}`, "memory_search", { query: `q${req.messages.length}` })
      : say("done"),
  );
  const io = {
    system: "system",
    history: [],
    input: { role: "user", content: "go" },
    tools: [{ type: "function", function: { name: "any", description: "", parameters: {} } }],
    steps: 30,
    models: ["fake/fake-1"],
    signal: new AbortController().signal,
    thread: { id: "t1" },
    onText() {},
    log() {},
    async execute() {
      return { ok: true, text: "ok" };
    },
  } as unknown as TurnIO;
  await nativeHarness(llm).run(io);
  assert.equal(llm.calls.filter((c) => c.tools.length).length, 30);
});
