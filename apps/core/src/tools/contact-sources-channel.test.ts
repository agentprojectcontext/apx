import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { fakeWhatsApp } from "../channels/fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "../channels/whatsapp.ts";
import { callTool, say } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { sourceFixture } from "./contact-sources.test-support.ts";

test("WhatsApp answers from the specifically authorized document with assigned identity, then loses access on revocation", async () => {
  const wa = fakeWhatsApp();
  const h = await sourceFixture(
    (req, { afterTool }) =>
      afterTool
        ? say(String(req.messages.at(-1)?.content))
        : callTool("doc", "consult_contact_sources", { query: "delivery" }),
    {
      channelAdapters: {
        whatsapp: (c) =>
          whatsappAdapter({
            dir: path.join(h.env.home, "wa"),
            selfOwner: c.self_owner === true,
            lib: async () => wa.lib,
          }),
      },
    },
  );
  try {
    await h.env.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", self_owner: true, agent_id: "superagent" },
    });
    const channel = async () =>
      (await h.env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
    await waitFor(async () => Boolean((await channel())?.qr), "QR to scan");
    wa.scan();
    await waitFor(async () => (await channel())?.status === "running", "linked");
    const buyer = { name: "Acme Buyer", phone: "5491100000002@s.whatsapp.net" };
    await h.env.client.call("contacts.address", { person: h.person.id, channel: "whatsapp", address: buyer.phone });
    wa.message(buyer, "What is the delivery schedule?");
    await waitFor(
      () => wa.sent.some((s) => String(s.content.text).includes("arrives Tuesday")),
      "document-based answer",
    );
    const thread = h.env.core.store.threads
      .list()
      .find((t) => t.channel?.id === "whatsapp" && t.channel.person_id === h.person.id);
    assert.ok(thread);
    assert.deepEqual(thread.agent_ids, [h.agent.id]);
    assert.equal(thread.project_id, h.project.id);
    const steps = h.env.core.store.runs.list(thread.id).flatMap((r) => h.env.core.store.runs.steps(r.id));
    const result = steps.find((s) => s.tool === "consult_contact_sources")?.result ?? "";
    assert.match(result, /Delivery record/);
    assert.match(result, /arrives Tuesday/);
    await h.env.client.call("contacts.set", {
      id: h.person.id,
      name: h.person.name,
      perms: { notes: false, any_hour: true },
    });
    const before = wa.sent.length;
    wa.message(buyer, "Read the delivery document again");
    await waitFor(() => wa.sent.length > before, "reply after revocation");
    const newest = h.env.core.store.runs.list(thread.id)[0];
    assert.ok(newest);
    assert.notEqual(
      h.env.core.store.runs.steps(newest.id).find((s) => s.tool === "consult_contact_sources")?.state,
      "ok",
    );
  } finally {
    await h.close();
  }
});

test("a contact can propose but cannot list or approve private corrections through owner methods", async () => {
  const h = await sourceFixture();
  try {
    const update = h.repo.propose(
      h.thread.id,
      h.agent.id,
      h.run().id,
      h.source.id,
      h.source.revision,
      "Tuesday",
      "Wednesday",
    );
    const model = new ApxClient({ url: h.env.core.url, actor: "agent" });
    await assert.rejects(model.call("contacts.sources.list", { person: h.person.id }), /is reserved to the owner/);
    await assert.rejects(model.call("contacts.source_updates.list", {}), /is reserved to the owner/);
    await assert.rejects(
      model.call("contacts.source_updates.resolve", { id: update.id, accept: true }),
      /is reserved to the owner/,
    );
    assert.equal(h.repo.updates()[0]?.state, "pending");
  } finally {
    await h.close();
  }
});
