// The built-in loop's limits: a browser session looks again as often as it needs and gets more steps than a plain
// turn; the same call again and again in a row is reminded first and stuck only at the eighth.
import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm } from "../engine/testkit.ts";
import { type ChatItem, ProviderError } from "../providers/types.ts";
import { MAX_STEPS, nativeHarness } from "./native.ts";
import { clearOlderOutput, outputChars } from "./output-trim.ts";
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
  assert.equal(same.ran.length, 5, "reminded, never cut, before the eighth");
  assert.deepEqual(
    notes(same.seen).map(
      (n) => /same arguments (\d+) times in a row\. If it is not getting you closer/.exec(String(n))?.[1],
    ),
    ["3", "5"],
  );
});

test("the same call eight times in a row is stuck: tools go off and the turn answers", async () => {
  const { out, ran, seen } = await turn((done) =>
    // Keys in another order are still the same call.
    callTool(`x${done}`, "memory_search", done % 2 ? { query: "q", limit: 5 } : { limit: 5, query: "q" }),
  );
  assert.equal(ran.length, 8);
  assert.equal(out.text, "no tools left");
  assert.match(
    String(notes(seen).at(-1)),
    /memory_search with the same arguments 8 times in a row\. Stop calling tools/,
  );
});

test("the same call between others is not a repeat: work that comes back to a read is not stuck", async () => {
  const { ran, seen } = await turn((done) =>
    done >= 12
      ? say("done")
      : done % 2
        ? callTool(`w${done}`, "file_write", { path: `f${done}.txt`, content: "x" })
        : callTool(`r${done}`, "file_read", { path: "notes.md" }),
  );
  assert.equal(ran.length, 12);
  assert.deepEqual(notes(seen), []);
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

test("the usage reported while a turn runs names the window of the model that answered", async () => {
  const llm = scriptedLlm(() => ({ ...say("done"), model: "fake/claude-test", usage: { input: 5000, output: 3 } }));
  const seen: unknown[] = [];
  const io = {
    system: "system",
    history: [],
    input: { role: "user", content: "go" },
    tools: [],
    models: ["fake/claude-test"],
    signal: new AbortController().signal,
    thread: { id: "t1" },
    onText() {},
    onUsage: (u: unknown) => seen.push(u),
    log() {},
  } as unknown as TurnIO;
  await nativeHarness(llm).run(io);
  assert.deepEqual(seen.at(-1), { input: 5000, output: 3, context: 5000, window: 200_000 });
});

test("older output is cleared once kept results fill the budget: calls stay paired, the newest stay whole", () => {
  const items: ChatItem[] = [{ role: "user", content: "go" }];
  for (let i = 0; i < 6; i++)
    items.push(
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: `c${i}`, type: "function", function: { name: "file_read", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: `c${i}`, content: String(i).repeat(1000) },
    );
  const out = clearOlderOutput(items, 2500);
  const results = out.filter((m) => m.role === "tool").map((m) => String(m.content));
  assert.deepEqual(
    results.map((r) => r.startsWith("[earlier output of file_read omitted: 1000 chars")),
    [true, true, true, true, false, false],
  );
  assert.equal(out.length, items.length);
  assert.deepEqual(clearOlderOutput(out, 2500), out, "clearing again changes nothing");
  assert.equal(clearOlderOutput(items, 0, 1).filter((m) => m.role === "tool" && m.content.length === 1000).length, 1);
});

test("a long reading turn re-sends a bounded context: older results are cleared, the work goes on", async () => {
  // 60 reads of 12k characters (the cap of one result): 720k characters if all were kept.
  const { out, ran, seen } = await turn(
    (done) => (done >= 60 ? say("read them all") : callTool(`r${done}`, "file_read", { path: `f${done}.ts` })),
    (_name, args) => `${String(args.path)}\n${"x".repeat(12_000)}`,
  );
  assert.equal(out.text, "read them all");
  assert.equal(ran.length, 60);
  assert.ok(outputChars(seen) <= 240_000, `kept ${outputChars(seen)} characters of output`);
  const last = seen.filter((m) => m.role === "tool").at(-1);
  assert.match(String(last?.content), /^f59\.ts/, "the newest result is whole");
});

test("a chat too long for the model is retried once with only the newest results", async () => {
  let refused = 0;
  const llm = scriptedLlm((req) => {
    if (outputChars(req.messages) > 30_000) {
      refused++;
      throw new ProviderError("context", "fake/fake-1: prompt is too long");
    }
    const done = toolResults(req.messages);
    return done >= 4 ? say("done") : callTool(`r${done}`, "file_read", { path: `f${done}` });
  });
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
    async execute() {
      return { ok: true, text: "y".repeat(9_000) };
    },
  } as unknown as TurnIO;
  const out = await nativeHarness(llm).run(io);
  assert.equal(out.text, "done");
  assert.equal(refused, 1, "one squeeze was enough");
});

test("after a step that only worked the screen, the next call reasons lighter; other steps keep the model's own", async () => {
  const plan = [
    callTool("s1", "screen_snapshot", {}),
    callTool("d1", "screen_do", { app: "Notes", steps: [] }),
    callTool("m1", "memory_search", { query: "q" }),
    say("done"),
  ];
  const llm = scriptedLlm((req) => plan[toolResults(req.messages)] ?? say("done"));
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
    async execute() {
      return { ok: true, text: "ok" };
    },
  } as unknown as TurnIO;
  await nativeHarness(llm).run(io);
  assert.deepEqual(
    llm.calls.map((c) => c.lighter),
    [undefined, "low", "low", undefined],
  );
});

/** The native loop over a provider that fails on some calls; waits are recorded, never slept. */
async function flaky(fail: (call: number, tools: number) => boolean) {
  let call = 0;
  const llm = scriptedLlm((req) => {
    if (fail(call++, toolResults(req.messages))) throw new ProviderError("empty", "fake/fake-1: empty stream");
    return toolResults(req.messages) < 2 ? callTool(`c${call}`, "any", {}) : say("all done");
  });
  const waits: number[] = [];
  const ran: string[] = [];
  const logged: ChatItem[] = [];
  const io = {
    system: "system",
    history: [],
    input: { role: "user", content: "go" },
    tools: [{ type: "function", function: { name: "any", description: "", parameters: {} } }],
    models: ["fake/fake-1"],
    signal: new AbortController().signal,
    thread: { id: "t1" },
    onText() {},
    log: (items: ChatItem[]) => logged.push(...items),
    async execute(id: string) {
      ran.push(id);
      return { ok: true, text: "ok" };
    },
  } as unknown as TurnIO;
  const run = nativeHarness(llm, {
    patienceMs: [10, 20, 40],
    sleep: async (ms) => void waits.push(ms),
  }).run(io);
  return { run, waits, ran, logged };
}

test("a stream that comes back empty once is asked again and the turn completes", async () => {
  const { run, waits, ran } = await flaky((call) => call === 1);
  assert.equal((await run).text, "all done");
  assert.deepEqual(waits, [10]);
  assert.equal(ran.length, 2, "the tool work before and after the hiccup ran once each");
});

test("a provider that stays empty fails after bounded tries, the tool results so far kept", async () => {
  const { run, waits, ran, logged } = await flaky((call) => call >= 2);
  await assert.rejects(run, (err: Error) => {
    assert.match(err.message, /empty stream/);
    assert.match(err.message, /asked again 3 times; the work so far is kept/);
    return true;
  });
  assert.deepEqual(waits, [10, 20, 40]);
  assert.equal(ran.length, 2);
  assert.equal(logged.filter((m) => m.role === "tool").length, 2, "the finished tool calls stay in the log");
});

test("a usage limit or a rejected request is not asked again by the turn", async () => {
  const llm = scriptedLlm(() => {
    throw new ProviderError("quota", "fake/fake-1: out of credit");
  });
  const waits: number[] = [];
  const io = {
    system: "system",
    history: [],
    input: { role: "user", content: "go" },
    tools: [],
    models: ["fake/fake-1"],
    signal: new AbortController().signal,
    thread: { id: "t1" },
    onText() {},
    log() {},
  } as unknown as TurnIO;
  await assert.rejects(nativeHarness(llm, { sleep: async (ms) => void waits.push(ms) }).run(io), /out of credit/);
  assert.deepEqual(waits, []);
});

test("canceling during the wait ends the turn at once", async () => {
  const ctl = new AbortController();
  const llm = scriptedLlm(() => {
    throw new ProviderError("network", "fake/fake-1: fetch failed");
  });
  const io = {
    system: "system",
    history: [],
    input: { role: "user", content: "go" },
    tools: [],
    models: ["fake/fake-1"],
    signal: ctl.signal,
    thread: { id: "t1" },
    onText() {},
    log() {},
  } as unknown as TurnIO;
  const run = nativeHarness(llm, {
    sleep: async () => {
      ctl.abort(new Error("canceled"));
      throw ctl.signal.reason;
    },
  }).run(io);
  await assert.rejects(run, /canceled/);
});
