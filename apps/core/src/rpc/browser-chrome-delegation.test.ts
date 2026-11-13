// Work an agent does for the owner's own turn reaches their Chrome as that turn does; work for anyone else never does.
// See DECISIONS.md#d-226
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { chromeReach, type Origin, type ReachLookup, type ReachRun } from "../domain/runs.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  const last = () => String(req.messages.findLast((m) => m.role === "tool")?.content).slice(0, 300);
  if (said.includes("touch tab c1"))
    return afterTool ? say(`Tool: ${last()}`) : callTool("x1", "browser_text", { tab: "c1" });
  if (said.includes("open the orders"))
    return afterTool
      ? say(`Tool: ${last()}`)
      : callTool("o1", "browser_open", { url: "https://northwind.example/orders" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let desktop: ApxSocket;
let chrome: ApxSocket;
const calls: Array<{ node: string; method: string }> = [];

/** A browser node whose tabs start with `open`, recording every call. */
function fakeNode(socket: ApxSocket, node: string, prefix: string, open: string[] = []) {
  const tabs: Array<Record<string, unknown>> = open.map((tab) => ({
    tab,
    url: "https://northwind.example/late",
    title: `${node} late`,
    profile: "shared",
    control: { kind: "idle" },
  }));
  socket.onRequest(async (method, raw) => {
    const params = (raw ?? {}) as Record<string, unknown>;
    calls.push({ node, method });
    if (method === "browser.tabs") return { tabs };
    if (method === "browser.open") {
      const tab = {
        tab: `${prefix}${tabs.length + 1}`,
        url: params.url,
        title: `${node} orders`,
        profile: "shared",
        control: { kind: "agent", by: params.by, since: new Date().toISOString() },
      };
      tabs.push(tab);
      return tab;
    }
    if (method === "browser.hold") return { ok: true };
    if (method === "browser.text")
      return { url: "https://northwind.example/late", text: `${node} text`, total: 9, truncated: false };
    throw new Error(`unexpected ${method}`);
  });
}

before(async () => {
  env = await startCore({ llm });
  desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  fakeNode(desktop, "desktop", "t");
  chrome = await new ApxClient({ url: env.core.url }).connect("node", ["chrome"]);
  fakeNode(chrome, "chrome", "c", ["c1"]);
});
after(async () => {
  desktop.close();
  chrome.close();
  await env.core.close();
  await env.cleanup();
});

const chat = async () => (await env.client.call("threads.create", { kind: "agent", agent_id: "superagent" })).id;

/** The owner's own turn in `thread` (from APX's panel in Chrome with `via`); its run's id. */
async function ownerTurn(thread: string, via?: "chrome"): Promise<string> {
  await env.client.call("threads.send", { thread, text: "hello", ...(via ? { via } : {}) });
  const { messages } = await env.settle(thread, 15_000);
  const run = messages.findLast((m) => m.author.kind === "agent")?.run_id;
  assert.ok(run, "the owner's turn ran");
  return run;
}

/** A turn admitted with `origin` on `text`, run to its end: its last words. */
async function turnFrom(
  thread: string,
  origin: Origin,
  text: string,
  extra: { parent_run_id?: string; trigger?: "a2a" | "a2a_result" | "routine" } = {},
): Promise<{ run: string; said: string }> {
  const run = env.core.engine.admit({
    thread_id: thread,
    agent_id: "superagent",
    trigger: extra.trigger ?? "a2a",
    origin,
    text,
    ...(extra.parent_run_id ? { parent_run_id: extra.parent_run_id } : {}),
  });
  await env.settle(thread, 15_000);
  const part = env.core.store.messages
    .list(thread, 60)
    .findLast((m) => m.run_id === run.id)
    ?.parts.find((p) => p.type === "text");
  return { run: run.id, said: part && "text" in part ? part.text : "" };
}

const helperOf = (thread: string, run: string, more: Partial<Extract<Origin, { kind: "agent" }>> = {}): Origin => ({
  kind: "agent",
  id: "superagent",
  name: "Roby",
  thread_id: thread,
  run_id: run,
  ...more,
});

test("a helper delegated to from the owner's turn reaches their Chrome, and so does the turn that hears its result", async () => {
  const thread = await chat();
  const owner = await ownerTurn(thread);
  calls.length = 0;
  const helper = await turnFrom(thread, helperOf(thread, owner), "touch tab c1", { parent_run_id: owner });
  assert.match(helper.said, /chrome text/);
  // A helper of that helper is still the owner's work.
  const deeper = await turnFrom(thread, helperOf(thread, helper.run), "touch tab c1", { parent_run_id: helper.run });
  assert.match(deeper.said, /chrome text/);
  // The delegating agent hearing the result goes on with the same reach.
  const heard = await turnFrom(
    thread,
    {
      kind: "delegation_result",
      agent_id: "superagent",
      name: "Roby",
      thread_id: thread,
      run_id: helper.run,
      state: "completed",
    },
    "touch tab c1",
    { trigger: "a2a_result" },
  );
  assert.match(heard.said, /chrome text/);
  assert.deepEqual(
    calls.filter((c) => c.method === "browser.text").map((c) => c.node),
    ["chrome", "chrome", "chrome"],
  );
});

test("a helper of a turn from APX's panel in Chrome browses only there", async () => {
  const thread = await chat();
  const owner = await ownerTurn(thread, "chrome");
  calls.length = 0;
  const helper = await turnFrom(thread, helperOf(thread, owner), "open the orders", { parent_run_id: owner });
  assert.match(helper.said, /chrome orders/);
  assert.deepEqual(
    calls.filter((c) => c.method === "browser.open").map((c) => c.node),
    ["chrome"],
  );
  // Only the owner's own words carry Chrome's mark: the helper's answer is not theirs.
  assert.equal(env.core.store.messages.list(thread, 20).findLast((m) => m.run_id === helper.run)?.via, undefined);
});

test("work not done for the owner never sees or reaches their Chrome", async () => {
  const thread = await chat();
  const owner = await ownerTurn(thread);
  // New mail is a third party's text: a helper of that turn works for no one the owner trusts with Chrome.
  const mail = await turnFrom(thread, { kind: "mail", count: 1 }, "hello", { trigger: "routine" });
  // An agent asked by another agent on its own (no run of the owner's above it).
  const loose = await turnFrom(thread, helperOf(thread, "run_gone"), "hello");
  calls.length = 0;
  const refused = [
    ["mail", helperOf(thread, mail.run)],
    ["an agent on its own", helperOf(thread, loose.run)],
    // An outside app's agent naming the owner's run is still an outside app.
    ["an outside app", helperOf(thread, owner, { id: "client:acme", name: "Acme bot" })],
    // A task an agent gave is not a delegation of the owner's turn (DECISIONS.md#d-223).
    ["an agent's task", helperOf(thread, owner, { task_assignment: { task: "tk_acme", id: "as_acme" } })],
  ] as const;
  for (const [who, origin] of refused) {
    const turn = await turnFrom(thread, origin, "touch tab c1");
    assert.doesNotMatch(turn.said, /chrome text/, who);
    assert.match(turn.said, /unknown tab c1|only the owner's own work/, who);
  }
  assert.equal(calls.filter((c) => c.node === "chrome" && c.method !== "browser.tabs").length, 0);
  // Asking the core directly for a new tab there is refused too.
  const helper = await turnFrom(thread, helperOf(thread, mail.run), "hello");
  const ctx = {
    transport: "internal" as const,
    role: "operator" as const,
    actor: "agent" as const,
    session: undefined,
    log: createLog("test", true),
    agent: { id: "superagent", run_id: helper.run, thread_id: thread },
  };
  const out = await env.core.dispatch(
    "browser.open",
    { url: "https://northwind.example/orders", chrome: true },
    ctx,
    "open-in-chrome",
  );
  assert.equal(out.ok, false);
  assert.match(JSON.stringify(out), /only the owner's own work/);
  assert.equal(calls.filter((c) => c.method === "browser.open").length, 0);
});

test("the reach follows every hop up to whoever asked, and stops after ten", () => {
  const runs = new Map<string, ReachRun>([
    ["r_owner", { origin: { kind: "user" }, ownerTask: false }],
    ["r_panel", { origin: { kind: "user", via: "chrome" }, ownerTask: false }],
    ["r_help", { origin: helperOf("t", "r_panel"), parent_run_id: "r_panel", ownerTask: false }],
    ["r_help2", { origin: helperOf("t", "r_owner"), parent_run_id: "r_owner", ownerTask: false }],
    ["r_task", { origin: helperOf("t", "r_gone"), ownerTask: true }],
  ]);
  const at: ReachLookup = { inputRun: (id) => (id === "in_help" ? "r_help" : undefined), run: (id) => runs.get(id) };
  const result = (run: string) =>
    ({ agent_id: "a", name: "A", thread_id: "t", run_id: run, state: "completed" }) as const;
  assert.equal(chromeReach(helperOf("t", "r_help"), false, at), "all");
  assert.equal(chromeReach({ kind: "input_answer", input_id: "in_help" }, false, at), "all");
  assert.equal(chromeReach({ kind: "delegation_result", ...result("r_help2") }, false, at), "asked");
  assert.equal(
    chromeReach({ kind: "delegation_results", results: [{ ...result("r_help2"), answer: "done" }] }, false, at),
    "asked",
  );
  // A helper asked from a chat of a task the owner created.
  assert.equal(chromeReach(helperOf("t", "r_task"), false, at), "asked");
  assert.equal(
    chromeReach(
      { kind: "hours_began", channel: "x", conversation: "x", person_id: "p", name: "P", since: "" },
      false,
      at,
    ),
    undefined,
  );
  // A chain that loops on itself ends without reach.
  runs.set("r_loop", { origin: helperOf("t", "r_loop"), ownerTask: false });
  assert.equal(chromeReach(helperOf("t", "r_loop"), false, at), undefined);
});
