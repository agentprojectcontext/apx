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

before(async () => {
  env = await startCore({ llm });
  desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  desktop.onRequest(async (method) => {
    if (method === "browser.tabs")
      return {
        tabs: [
          { tab: "t1", url: "https://example.com/", title: "Example", profile: "shared", control: { kind: "idle" } },
        ],
      };
    if (method === "browser.snapshot") {
      snapshots.push(Date.now());
      return { url: "https://example.com/", title: "Example", tree: 'button "Send" [e1]', refs: 1, truncated: false };
    }
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

test("the agent is told a send the owner asked for stays its own, not a hand-off", async () => {
  const system = String(llm.calls[0]?.messages[0]?.content);
  assert.match(system, /send, post or pay stays yours/);
  assert.match(system, /browser_snapshot wait_s/);
});
