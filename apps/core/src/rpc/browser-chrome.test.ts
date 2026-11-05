// A turn the owner wrote in APX's panel in Chrome browses in their Chrome; every other turn keeps APX's own browser.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
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
    // Nothing of the owner's Chrome is held for idle closing.
    assert.equal(calls.filter((c) => c.node === "desktop").length, 0);

    // The same words written anywhere else use APX's own browser.
    calls.length = 0;
    assert.match(await turn(thread), /tab t1 · desktop orders/);
    assert.equal(calls.filter((c) => c.node === "chrome").length, 0);
  } finally {
    chrome.close();
  }
});

test("with Chrome not connected, the agent is told so instead of using another browser", async () => {
  await waitFor(() => (env.core.broker.withCap("chrome") ? undefined : true), "Chrome gone", { ms: 5000 });
  calls.length = 0;
  assert.match(await turn(await chat(), "chrome"), /Chrome is not connected/);
  assert.equal(calls.filter((c) => c.method === "browser.open").length, 0);
});

test("the agent reads that the owner wrote from Chrome", () => {
  const input = llm.calls.findLast((c) => JSON.stringify(c.messages).includes("panel in the owner's Chrome"));
  assert.ok(input, "a Chrome turn's input says where it was written");
});
