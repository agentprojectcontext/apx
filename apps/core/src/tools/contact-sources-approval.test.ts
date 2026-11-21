import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { callTool, say } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { sourceFixture } from "./contact-sources.test-support.ts";

for (const { decision, accept, state, es } of [
  { decision: "approve", accept: true, state: "accepted", es: false },
  { decision: "deny", accept: true, state: "pending", es: false },
  { decision: "approve", accept: false, state: "rejected", es: true },
] as const) {
  test(`a contact's actual tool proposal waits for a private owner card even in Total: ${state}`, async () => {
    const h = await sourceFixture((req, { said, afterTool }) => {
      if (afterTool) return say(String(req.messages.at(-1)?.content));
      if (said.startsWith("{")) return callTool("settings", "apx_settings", JSON.parse(said));
      return callTool("correction", "propose_contact_update", {
        source: h.source.id,
        revision: h.source.revision,
        old: "Tuesday",
        replacement: "Wednesday",
      });
    });
    try {
      h.env.core.engine.admit({
        thread_id: h.thread.id,
        agent_id: h.agent.id,
        trigger: "channel",
        text: "The delivery is now Wednesday.",
        origin: {
          kind: "channel",
          channel: "test",
          conversation: h.person.id,
          person_id: h.person.id,
          name: h.person.name,
          role: "contact",
          message_id: "incoming-correction",
        },
      });
      await h.env.settle(h.thread.id);
      const update = h.repo.updates()[0];
      assert.ok(update);
      assert.equal(update.message, "incoming-correction");
      assert.equal(update.state, "pending");
      const steps = h.env.core.store.runs.list(h.thread.id).flatMap((r) => h.env.core.store.runs.steps(r.id));
      const step = steps.find((s) => s.tool === "propose_contact_update");
      assert.equal(step?.state, "ok");
      assert.match(step?.result ?? "", /No document or memory was changed/);
      assert.match(fs.readFileSync(h.file, "utf8"), /Tuesday/);
      h.env.core.store.settings.set("owner_language", es ? "es" : "en");
      await h.env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
      const owner = await h.env.client.call("threads.create", {
        kind: "loose",
        agent_id: "superagent",
        title: "Review a correction",
      });
      await h.env.client.call("threads.send", {
        thread: owner.id,
        text: JSON.stringify({ method: "contacts.source_updates.resolve", params: { id: update.id, accept } }),
      });
      const input = await waitFor(
        async () =>
          (await h.env.client.call("runs.pending", { thread: owner.id })).inputs.find((i) => i.tool === "apx_settings"),
        "private correction confirmation",
      );
      assert.equal(h.env.core.store.inputs.get(input.id)?.app_only, true);
      assert.match(input.detail ?? "", /Acme Buyer/);
      assert.match(input.detail ?? "", es ? /Canal: Conversación original/ : /Channel: Original conversation/);
      assert.match(input.detail ?? "", /Delivery record/);
      assert.match(input.detail ?? "", es ? /Antes:\nTuesday/ : /Before:\nTuesday/);
      assert.match(input.detail ?? "", es ? /Después:\nWednesday/ : /After:\nWednesday/);
      assert.match(fs.readFileSync(h.file, "utf8"), /Tuesday/);
      await h.env.client.call("runs.respond", { input: input.id, decision });
      await h.env.settle(owner.id);
      assert.match(fs.readFileSync(h.file, "utf8"), state === "accepted" ? /Wednesday/ : /Tuesday/);
      assert.equal(h.repo.updates()[0]?.state, state);
    } finally {
      await h.close();
    }
  });
}
