import assert from "node:assert/strict";
import { test } from "node:test";
import type { TabInfo, ToolApproval } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

for (const scope of ["tab", "turn"] as const) {
  for (const change of ["closure", "navigation", "owner takeover", "foreign event"] as const) {
    test(`${scope} consent after successful execution respects ${change} observed before the response`, async () => {
      let active: ToolApproval[] = [];
      let resultTrace = "";
      let thread = "";
      const env = await startCore({
        llm: scriptedLlm((req) => {
          const results = req.messages.filter((message) => message.role === "tool");
          if (!results.length)
            return callTool("js", "browser_evaluate", {
              tab: "tab1",
              origin: "https://example.com",
              document: "doc1",
              script: "42",
            });
          resultTrace = JSON.stringify(results);
          active = env.core.store.approvals.list(thread).filter((grant) => !!grant.browser);
          return say("Done");
        }),
      });
      const node = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
      const other =
        change === "foreign event" ? await new ApxClient({ url: env.core.url }).connect("node", ["fs"]) : undefined;
      const tab: TabInfo = {
        tab: "tab1",
        title: "Example",
        url: "https://example.com/",
        profile: "shared",
        control: { kind: "idle" },
        consent_epoch: "epoch1",
      };
      let observed = false;
      let evaluations = 0;
      env.core.bus.on((event) => {
        if (event.type === "browser.tabs") observed = true;
      });
      node.onRequest(async (method) => {
        if (method === "browser.hold") return { ok: true };
        if (method === "browser.tabs") return { tabs: [tab] };
        if (method === "browser.approval_context") return { epoch: "epoch1" };
        if (method === "browser.evaluate") {
          evaluations++;
          if (other) {
            other.emit("browser", "tabs.changed", { tabs: [] });
            // A round trip on the same connection proves its earlier event was processed.
            await assert.rejects(other.call("agents.list", {}), /not available to nodes/);
            assert.equal(observed, false);
          } else {
            const tabs =
              change === "closure"
                ? []
                : [
                    {
                      ...tab,
                      ...(change === "navigation"
                        ? { consent_epoch: "epoch2" }
                        : { control: { kind: "user" as const, since: "now" } }),
                    },
                  ];
            node.emit("browser", "tabs.changed", { tabs });
            await waitFor(() => observed);
          }
          return { url: "https://example.com/", json: "42" };
        }
        throw new Error(`Unexpected ${method}`);
      });
      try {
        thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
        await env.client.call("threads.send", { thread, text: "Evaluate the page" });
        const input = await waitFor(async () => (await env.client.call("runs.pending", { thread })).inputs[0]);
        await env.client.call("runs.respond", { input: input.id, decision: "approve", scope });
        await env.settle(thread);
        assert.equal(evaluations, 1);
        assert.match(resultTrace, /42/);
        assert.doesNotMatch(resultTrace, /not executed|not run|declined/i);
        assert.equal(active.length, scope === "turn" || change === "foreign event" ? 1 : 0);
        assert.equal(
          (await env.client.call("tools.approvals", { thread })).approvals.filter((grant) => !!grant.browser).length,
          scope === "tab" && change === "foreign event" ? 1 : 0,
        );
      } finally {
        other?.close();
        if (other) await other.closed;
        node.close();
        await node.closed;
        await env.core.close();
        await env.cleanup();
      }
    });
  }
}
