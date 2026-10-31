import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

test("revocation during the last tab ownership check prevents JavaScript dispatch", async () => {
  const env = await startCore({
    llm: scriptedLlm((req) =>
      req.messages.filter((message) => message.role === "tool").length >= 2
        ? say("Done")
        : callTool(`js${req.messages.length}`, "browser_evaluate", {
            tab: "t1",
            origin: "https://example.com",
            document: "doc1",
            script: "42",
          }),
    ),
  });
  const desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  let evaluations = 0;
  let revoked = false;
  let tabsAfterContext = 0;
  desktop.onRequest(async (method) => {
    if (method === "browser.approval_context") {
      tabsAfterContext = 0;
      return { epoch: "epoch1" };
    }
    if (method === "browser.hold") return { ok: true };
    if (method === "browser.tabs") {
      tabsAfterContext++;
      const grant = env.core.store.approvals.list().find((row) => row.browser);
      if (grant && evaluations === 1 && tabsAfterContext === 2) {
        env.core.store.approvals.revoke(grant.key, grant.thread_id, grant.agent_id);
        revoked = true;
      }
      return {
        tabs: [
          { tab: "t1", url: "https://example.com/", title: "Example", profile: "shared", control: { kind: "idle" } },
        ],
      };
    }
    if (method === "browser.evaluate") {
      evaluations++;
      return { url: "https://example.com/", json: "42" };
    }
    throw new Error(`Unexpected ${method}`);
  });
  try {
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
    await env.client.call("threads.send", { thread, text: "Evaluate a harmless expression" });
    const card = await waitFor(async () => (await env.client.call("runs.pending", { thread })).inputs[0]);
    await env.client.call("runs.respond", { input: card.id, decision: "approve", scope: "tab" });
    await env.settle(thread);
    assert.equal(revoked, true);
    assert.equal(evaluations, 1, "only the initially approved call ran; the revoked second call never dispatched");
    const parts = (await env.client.call("threads.get", { thread })).messages.flatMap((message) => message.parts);
    assert.ok(
      parts.some((part) => part.type === "tool" && part.status === "error" && /revoked/.test(part.detail ?? "")),
    );
  } finally {
    desktop.close();
    await desktop.closed;
    await env.core.close();
    await env.cleanup();
  }
});
