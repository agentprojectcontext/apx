// A turn the owner wrote in APX's panel in Chrome browses in their Chrome; every other turn keeps APX's own browser.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  const last = () => String(req.messages.findLast((m) => m.role === "tool")?.content).slice(0, 300);
  if (said.includes("in my Chrome")) {
    if (!afterTool) return callTool("m1", "browser_open", { url: "https://northwind.example/late", chrome: true });
    const tab = /^tab (c\d+)/.exec(String(req.messages.findLast((m) => m.role === "tool")?.content))?.[1];
    return tab ? callTool("m2", "browser_text", { tab }) : say(`Tool: ${last()}`);
  }
  if (said.includes("touch tab c1"))
    return afterTool ? say(`Tool: ${last()}`) : callTool("x1", "browser_text", { tab: "c1" });
  if (!said.includes("open the orders")) return say("ok");
  if (!afterTool) return callTool("o1", "browser_open", { url: "https://northwind.example/orders" });
  return say(`Tool: ${String(req.messages.findLast((m) => m.role === "tool")?.content).slice(0, 300)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let desktop: ApxSocket;
const calls: Array<{ node: string; method: string; params: Record<string, unknown> }> = [];

/** A node that opens one tab and lists what it opened, recording every call. */
function fakeNode(socket: ApxSocket, node: string, prefix: string) {
  const tabs: Array<Record<string, unknown>> = [];
  socket.onRequest(async (method, raw) => {
    const params = (raw ?? {}) as Record<string, unknown>;
    calls.push({ node, method, params });
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
});
after(async () => {
  desktop.close();
  await env.core.close();
  await env.cleanup();
});

const chat = async () => (await env.client.call("threads.create", { kind: "agent", agent_id: "superagent" })).id;

/** The agent's last words in the chat after one turn on "open the orders". */
async function turn(thread: string, via?: "chrome"): Promise<string> {
  await env.client.call("threads.send", { thread, text: "open the orders", ...(via ? { via } : {}) });
  const { messages } = await env.settle(thread, 15_000);
  const last = messages.findLast((m) => m.author.kind === "agent")?.parts.find((p) => p.type === "text");
  return last && "text" in last ? last.text : "";
}

test("a turn from APX's panel in Chrome opens its tab in the owner's Chrome", async () => {
  const chrome = await new ApxClient({ url: env.core.url }).connect("node", ["chrome"]);
  fakeNode(chrome, "chrome", "c");
  try {
    const thread = await chat();
    calls.length = 0;
    assert.match(await turn(thread, "chrome"), /tab c1 · chrome orders/);
    assert.deepEqual(
      calls.filter((c) => c.method === "browser.open").map((c) => c.node),
      ["chrome"],
    );
    // The tab's card in the chat says it is in Chrome, not in APX's browser.
    const card = env.core.store.messages
      .list(thread, 10)
      .flatMap((m) => m.parts)
      .find((p) => p.type === "browser");
    assert.equal(card && "environment" in card ? card.environment : undefined, "chrome");
    // The owner's words and the answer carry Chrome's mark, as a channel's do.
    assert.deepEqual(
      env.core.store.messages.list(thread, 10).map((m) => [m.author.kind, m.via]),
      [
        ["user", "chrome"],
        ["agent", "chrome"],
      ],
    );
    // Nothing of the owner's Chrome is held for idle closing.
    assert.equal(calls.filter((c) => c.node === "desktop").length, 0);

    // The same words written anywhere else, in a chat with no Chrome tab, use APX's own browser.
    calls.length = 0;
    const elsewhere = await chat();
    assert.match(await turn(elsewhere), /tab t1 · desktop orders/);
    assert.deepEqual(
      env.core.store.messages.list(elsewhere, 10).map((m) => m.via),
      [undefined, undefined],
    );
    // Its Chrome tabs are listed beside APX's for the owner's own turn; none is touched.
    assert.deepEqual(
      calls.filter((c) => c.node === "chrome").map((c) => c.method),
      calls.filter((c) => c.node === "chrome").map(() => "browser.tabs"),
    );
  } finally {
    chrome.close();
  }
});

test("asked in the app for their Chrome, the agent opens and reads a tab there; a turn not the owner's cannot", async () => {
  const chrome = await new ApxClient({ url: env.core.url }).connect("node", ["chrome"]);
  fakeNode(chrome, "chrome", "c");
  // Total autonomy: the card a new tab in the owner's Chrome asks for is covered by its own test of the mode.
  await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
  try {
    const thread = await chat();
    calls.length = 0;
    await env.client.call("threads.send", { thread, text: "check the late orders in my Chrome" });
    const { messages } = await env.settle(thread, 15_000);
    const reply = messages.findLast((m) => m.author.kind === "agent")?.parts.find((p) => p.type === "text");
    assert.match(reply && "text" in reply ? reply.text : "", /chrome text/);
    assert.deepEqual(
      calls.filter((c) => c.method === "browser.open" || c.method === "browser.text").map((c) => c.node),
      ["chrome", "chrome"],
    );
    // Not a Chrome turn: the words carry no Chrome mark, only the tab does.
    assert.equal(messages.find((m) => m.author.kind === "user")?.via, undefined);

    // A routine's turn (not the owner's words) never sees or reaches their Chrome, even naming one of its tabs.
    calls.length = 0;
    const run = env.core.engine.admit({
      thread_id: thread,
      agent_id: "superagent",
      trigger: "routine",
      origin: { kind: "routine", id: "rt_acme", name: "Acme check" },
      text: "touch tab c1",
    });
    await env.settle(thread, 15_000);
    const said = env.core.store.messages
      .list(thread, 20)
      .findLast((m) => m.run_id === run.id)
      ?.parts.find((p) => p.type === "text");
    assert.match(said && "text" in said ? said.text : "", /unknown tab c1/);
    // Asking for a new tab there is refused by the core itself.
    const asked = env.core.engine.admit({
      thread_id: thread,
      agent_id: "superagent",
      trigger: "routine",
      origin: { kind: "routine", id: "rt_acme", name: "Acme check" },
      text: "check the late orders in my Chrome",
    });
    await env.settle(thread, 15_000);
    const refused = env.core.store.messages
      .list(thread, 30)
      .findLast((m) => m.run_id === asked.id)
      ?.parts.find((p) => p.type === "text");
    assert.match(
      refused && "text" in refused ? refused.text : "",
      /only a turn the owner asked for may use their Chrome/,
    );
    assert.equal(calls.filter((c) => c.node === "chrome").length, 0);
  } finally {
    chrome.close();
    await env.client.call("agents.update", { agent: "superagent", autonomy: "auto" });
  }
});

test("with Chrome not connected, the agent is told so instead of using another browser", async () => {
  await waitFor(() => (env.core.broker.withCap("chrome") ? undefined : true), "Chrome gone", { ms: 5000 });
  calls.length = 0;
  assert.match(await turn(await chat(), "chrome"), /Chrome is closed and APX could not open it/);
  assert.equal(calls.filter((c) => c.method === "browser.open").length, 0);
});

test("the agent reads that the owner wrote from Chrome", () => {
  const input = llm.calls.findLast((c) => JSON.stringify(c.messages).includes("panel in the owner's Chrome"));
  assert.ok(input, "a Chrome turn's input says where it was written");
});
