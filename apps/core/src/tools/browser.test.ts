// Browser tools through a fake desktop node: an agent can wait on the page itself instead of reaching for a shell.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.findLast((m) => m.role === "tool")?.content).slice(0, 200)}`);
  if (said.includes("wait and look")) return callTool("w1", "browser_snapshot", { tab: "t1", wait_s: 1 });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let desktop: ApxSocket;
const snapshots: number[] = [];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const holds: Array<{ run: string; tabs: string[] }> = [];

before(async () => {
  env = await startCore({ llm });
  desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  desktop.onRequest(async (method, params) => {
    if (method === "browser.tabs")
      return {
        tabs: [
          { tab: "t1", url: "https://example.com/", title: "Example", profile: "shared", control: { kind: "idle" } },
        ],
      };
    if (method === "browser.hold") {
      holds.push(params as { run: string; tabs: string[] });
      return { ok: true };
    }
    if (method === "browser.snapshot") {
      snapshots.push(Date.now());
      return { url: "https://example.com/", title: "Example", tree: 'button "Send" [e1]', refs: 1, truncated: false };
    }
    if (method === "browser.screenshot")
      return { mime: "image/jpeg", data: JPEG.toString("base64"), bytes: JPEG.length };
    throw new Error(`unknown ${method}`);
  });
});
after(async () => {
  desktop.close();
  await env.core.close();
  env.cleanup();
});

test("browser_snapshot waits the seconds asked before reading the page", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  const sent = Date.now();
  await env.client.call("threads.send", { thread, text: "wait and look" });
  await env.settle(thread);
  assert.equal(snapshots.length, 1);
  assert.ok((snapshots[0] ?? 0) - sent >= 1000, "read after the wait");
  assert.match(String(llm.calls.at(-1)?.messages.findLast((m) => m.role === "tool")?.content), /Send/);
});

test("browser_snapshot shows the model a picture of the tab, not the chat", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "wait and look" });
  await env.settle(thread);
  const shown = llm.calls.at(-1)?.messages.at(-1) as { role: string; images?: Array<{ mime: string }> };
  assert.equal(shown.role, "user");
  assert.equal(shown.images?.[0]?.mime, "image/jpeg");
  const parts = (await env.client.call("threads.get", { thread })).messages.flatMap((m) => m.parts);
  assert.ok(!parts.some((p) => p.type === "image"), "the picture is for the model only");
});

test("the turn holds the tab it used while it runs and lets it go when it ends", async () => {
  holds.length = 0;
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "wait and look" });
  await env.settle(thread);
  for (let i = 0; i < 50 && holds.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  const run = holds[0]?.run ?? "";
  assert.ok(run);
  assert.deepEqual(holds, [
    { run, tabs: ["t1"] },
    { run, tabs: [] },
  ]);
});

test("the agent is told a send the owner asked for stays its own, not a hand-off", async () => {
  const system = String(llm.calls[0]?.messages[0]?.content);
  assert.match(system, /send, post or pay stays yours/);
  assert.match(system, /browser_snapshot wait_s/);
});
