import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { nativeApproval, strictApproval } from "../domain/approvals.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

for (const scope of ["tab", "turn"] as const) {
  test(`${scope} browser approval runs three successive evaluations with one app confirmation`, async () => {
    const llm = scriptedLlm((req) => {
      const count = req.messages.filter((message) => message.role === "tool").length;
      return count < 3
        ? callTool(`js${count}`, "browser_evaluate", {
            tab: "t1",
            origin: "https://example.com",
            document: "doc1",
            script: String(count),
          })
        : say("Done");
    });
    const env = await startCore({ llm });
    const desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
    const evaluations: unknown[] = [];
    desktop.onRequest(async (method, params) => {
      if (method === "browser.tabs")
        return {
          tabs: [
            { tab: "t1", url: "https://example.com/", title: "Example", profile: "shared", control: { kind: "idle" } },
          ],
        };
      if (method === "browser.approval_context") return { epoch: "epoch1" };
      if (method === "browser.hold") return { ok: true };
      if (method === "browser.evaluate") {
        evaluations.push(params);
        return { url: "https://example.com/", json: "42" };
      }
      throw new Error(`Unexpected ${method}`);
    });
    try {
      await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
      const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
      const ordinary = nativeApproval("browser_evaluate");
      env.core.store.approvals.grant(ordinary, "always", thread, "superagent");
      env.core.store.approvals.grant(strictApproval(ordinary), "always", thread, "superagent");
      await env.client.call("threads.send", { thread, text: "Evaluate three expressions" });
      const card = await waitFor(async () => (await env.client.call("runs.pending", { thread })).inputs[0]);
      assert.deepEqual(card.approval_scopes, ["once", "tab", "turn"]);
      assert.equal(evaluations.length, 0);
      for (const unavailable of ["always", "session", "project"] as const)
        await assert.rejects(
          env.client.call("runs.respond", { input: card.id, decision: "approve", scope: unavailable }),
          /scope.*not available/,
        );
      await env.client.call("runs.respond", { input: card.id, decision: "approve", scope });
      await env.settle(thread);
      assert.equal(evaluations.length, 3);
      const messages = (await env.client.call("threads.get", { thread })).messages;
      const confirmations = messages.flatMap((message) => message.parts).filter((part) => part.type === "input");
      assert.equal(confirmations.length, 1);
      const approvals = (await env.client.call("tools.approvals", { thread })).approvals;
      const temporary = approvals.filter((grant) => grant.browser !== undefined);
      assert.equal(temporary.length, scope === "tab" ? 1 : 0, "turn consent ends with the run");
      if (scope === "tab") {
        const grant = temporary[0];
        assert.ok(grant);
        await env.client.call("tools.revoke", { key: grant.key, thread, agent: "superagent" });
        assert.equal(
          (await env.client.call("tools.approvals", { thread })).approvals.filter((row) => row.browser !== undefined)
            .length,
          0,
        );
      }
    } finally {
      desktop.close();
      await desktop.closed;
      await env.core.close();
      await env.cleanup();
    }
  });
}
