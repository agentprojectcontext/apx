import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

test("two WhatsApp accounts keep project agents, histories and replies separate", async () => {
  const accounts = new Map([
    ["sales", fakeWhatsApp()],
    ["support", fakeWhatsApp()],
  ]);
  const llm = scriptedLlm((_req, { said }) => say(`Account reply: ${said}`));
  const env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (config) => {
        const fake = accounts.get(config.id);
        assert.ok(fake);
        return whatsappAdapter({
          dir: path.join(env.home, config.id),
          selfOwner: true,
          lib: async () => fake.lib,
        });
      },
    },
  });
  try {
    const agents = new Map<string, { id: string; project: string }>();
    for (const [id, fake] of accounts) {
      const { project } = await env.client.call("projects.create", { name: id });
      const agent = await env.client.call("agents.create", {
        project_id: project.id,
        slug: `${id}-helper`,
        name: `${id} helper`,
        role: "helper",
      });
      agents.set(id, { id: agent.id, project: project.id });
      await env.client.call("channels.set", {
        id,
        channel: { type: "whatsapp", agent_id: agent.id, self_owner: true },
      });
      await waitFor(async () => {
        const { channels } = await env.client.call("channels.list", {});
        return Boolean(channels.find((channel) => channel.id === id)?.qr);
      }, `${id} QR`);
      fake.scan();
      await waitFor(async () => {
        const { channels } = await env.client.call("channels.list", {});
        return channels.find((channel) => channel.id === id)?.status === "running";
      }, `${id} linked`);
    }
    env.core.store.nudges.add({
      kind: "routine:Private",
      text: "Owner-wide private notice",
      state: "sent",
      exempt: false,
    });
    for (const [id, fake] of accounts) fake.fromOwner(`Request for ${id}`);
    for (const [id, fake] of accounts) {
      await waitFor(() => fake.textsTo(fake.owner).some((text) => text.includes(`Request for ${id}`)), `${id} reply`);
      const thread = env.core.store.threads.byConversation(id, fake.owner);
      assert.ok(thread);
      assert.deepEqual(thread.agent_ids, [agents.get(id)?.id]);
      assert.equal(thread.project_id, agents.get(id)?.project);
      const chat = await env.client.call("threads.get", { thread: thread.id });
      const other = id === "sales" ? "support" : "sales";
      assert.ok(
        !chat.messages.some((message) =>
          message.parts.some((part) => part.type === "text" && part.text.includes(`Request for ${other}`)),
        ),
      );
      assert.ok(!fake.textsTo(fake.owner).some((text) => text.includes(`Request for ${other}`)));
    }
    const home = env.core.store.threads.get("home");
    assert.ok(
      !llm.calls.some((call) =>
        call.messages.some((message) => String(message.content).includes("Owner-wide private notice")),
      ),
    );
    assert.deepEqual(home?.agent_ids, ["superagent"]);
    assert.ok(
      !env.core.store.messages
        .list("home")
        .some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("Request for "))),
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
