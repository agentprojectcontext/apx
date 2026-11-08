import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const word = (id: string) => (id === "whatsapp" ? "sales" : "support");

test("two WhatsApp accounts keep their own session, agent, project and chats; removing one leaves the other", async () => {
  const accounts = new Map([
    ["whatsapp", fakeWhatsApp()],
    ["whatsapp-b2c4", fakeWhatsApp()],
  ]);
  const llm = scriptedLlm((_req, { said }) => say(`Reply to: ${said}`));
  const env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (config) => {
        const fake = accounts.get(config.id);
        assert.ok(fake, `an account for ${config.id}`);
        return whatsappAdapter({ dir: path.join(env.home, config.id), selfOwner: true, lib: async () => fake.lib });
      },
    },
  });
  try {
    const agents = new Map<string, { id: string; project: string }>();
    for (const [id, fake] of accounts) {
      const { project } = await env.client.call("projects.create", { name: `Acme ${id}` });
      const agent = await env.client.call("agents.create", {
        project_id: project.id,
        slug: `${id}-head`,
        name: "Head",
      });
      agents.set(id, { id: agent.id, project: project.id });
      await env.client.call("channels.set", {
        id,
        channel: { type: "whatsapp", agent_id: agent.id, self_owner: true, owner_thread: "own" },
      });
      await waitFor(async () => {
        const { channels } = await env.client.call("channels.list", {});
        return Boolean(channels.find((c) => c.id === id)?.qr);
      }, `${id} QR`);
      fake.scan();
      await waitFor(async () => {
        const { channels } = await env.client.call("channels.list", {});
        return channels.find((c) => c.id === id)?.status === "running";
      }, `${id} linked`);
    }
    const listed = (await env.client.call("channels.list", {})).channels;
    assert.deepEqual(
      listed.map((c) => c.label),
      ["WhatsApp", "WhatsApp 2"],
      "the second account is told apart in the list",
    );

    for (const [id, fake] of accounts) fake.fromOwner(`Request about ${word(id)}`);
    for (const [id, fake] of accounts) {
      await waitFor(
        () => fake.textsTo(fake.owner).some((text) => text.includes(`Request about ${word(id)}`)),
        `${id} reply`,
      );
      const other = id === "whatsapp" ? "whatsapp-b2c4" : "whatsapp";
      assert.ok(
        !fake.textsTo(fake.owner).some((text) => text.includes(`Request about ${word(other)}`)),
        "no crossed reply",
      );
      const thread = env.core.store.threads.byConversation(id, fake.owner);
      assert.deepEqual([thread?.agent_ids, thread?.project_id], [[agents.get(id)?.id], agents.get(id)?.project]);
    }

    await env.client.call("channels.set", { id: "whatsapp-b2c4", channel: null });
    assert.ok(!fs.existsSync(path.join(env.home, "whatsapp-b2c4")), "the removed account's session is gone");
    const left = (await env.client.call("channels.list", {})).channels;
    assert.deepEqual(
      left.map((c) => [c.id, c.status]),
      [["whatsapp", "running"]],
    );
    await env.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", agent_id: agents.get("whatsapp")?.id ?? "", self_owner: true, label: "Acme sales" },
    });
    await env.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", agent_id: agents.get("whatsapp")?.id ?? "", self_owner: true, strangers: "ignore" },
    });
    const renamed = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
    assert.equal(renamed?.label, "Acme sales", "a save without a name keeps the one the owner gave it");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
