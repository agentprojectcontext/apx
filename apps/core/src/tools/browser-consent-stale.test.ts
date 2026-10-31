import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

for (const scenario of [
  "navigation",
  "closure",
  "node reconnection",
  "profile transfer",
  "navigation after context reply",
  "concurrent decline during first dispatch",
] as const) {
  test(`${scenario} while a card waits cannot activate turn consent for a later snapshot`, async () => {
    let epoch = "epoch1";
    let present = true;
    let profile = "shared";
    let navigateAfterContext = false;
    let declineAfterDispatch = false;
    let firstInput = "";
    let evaluations = 0;
    const env = await startCore({
      llm: scriptedLlm((req) => {
        const count = req.messages.filter((message) => message.role === "tool").length;
        if (count >= 2) return say("Done");
        if (count === 1) {
          present = true;
          profile = "shared";
        }
        return callTool(`js${count}`, "browser_evaluate", {
          tab: "t1",
          origin: "https://example.com",
          document: count ? "doc2" : "doc1",
          script: "42",
        });
      }),
    });
    const connect = async () => {
      const node = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
      node.onRequest(async (method, params) => {
        if (method === "browser.approval_context") {
          if (!present) throw new Error("Tab closed");
          if ((params as { document: string }).document === "doc1" && epoch !== "epoch1")
            throw new Error("Document changed");
          const checked = epoch;
          if (navigateAfterContext) {
            epoch = "epoch2";
            navigateAfterContext = false;
          }
          return { epoch: checked };
        }
        if (method === "browser.hold") return { ok: true };
        if (method === "browser.tabs")
          return {
            tabs: present
              ? [
                  {
                    tab: "t1",
                    url: "https://example.com/",
                    title: "Example",
                    profile,
                    control: { kind: "idle" },
                    consent_epoch: epoch,
                  },
                ]
              : [],
          };
        if (method === "browser.evaluate") {
          if ((params as { epoch: string }).epoch !== epoch) throw new Error("Consent epoch changed before execution");
          evaluations++;
          if (declineAfterDispatch) {
            const input = env.core.store.inputs.get(firstInput);
            assert.ok(input?.approval);
            env.core.store.approvals.decline(input.approval, input.thread_id, input.agent_id);
            declineAfterDispatch = false;
          }
          return { url: "https://example.com/", json: "42" };
        }
        throw new Error(`Unexpected ${method}`);
      });
      return node;
    };
    let node = await connect();
    try {
      const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
      await env.client.call("threads.send", { thread, text: "Evaluate and retry with a fresh snapshot" });
      const first = await waitFor(async () => (await env.client.call("runs.pending", { thread })).inputs[0]);
      firstInput = first.id;
      if (scenario === "node reconnection") {
        node.close();
        await node.closed;
        node = await connect();
      } else if (scenario === "closure") present = false;
      else if (scenario === "profile transfer") profile = "isolated";
      else if (scenario === "navigation after context reply") navigateAfterContext = true;
      else if (scenario === "concurrent decline during first dispatch") declineAfterDispatch = true;
      else epoch = "epoch2";
      await env.client.call("runs.respond", { input: first.id, decision: "approve", scope: "turn" });
      const next = await waitFor(async () =>
        (await env.client.call("runs.pending", { thread })).inputs.find((input) => input.id !== first.id),
      );
      assert.equal(evaluations, scenario === "concurrent decline during first dispatch" ? 1 : 0);
      assert.equal(
        (await env.client.call("tools.approvals", { thread })).approvals.filter((grant) => grant.browser).length,
        0,
      );
      await env.client.call("runs.respond", { input: next.id, decision: "deny" });
      await env.settle(thread);
      if (scenario === "concurrent decline during first dispatch") {
        const parts = (await env.client.call("threads.get", { thread })).messages.flatMap((message) => message.parts);
        assert.ok(
          parts.some((part) => part.type === "tool" && part.status === "ok"),
          "already executed code must not be reported as not run",
        );
      }
      assert.equal(evaluations, scenario === "concurrent decline during first dispatch" ? 1 : 0);
    } finally {
      node.close();
      await node.closed;
      await env.core.close();
      await env.cleanup();
    }
  });
}
