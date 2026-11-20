import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeWhatsApp } from "../channels/fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "../channels/whatsapp.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

test("an assigned contact can search its agent's project notes only while notes are allowed", async () => {
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool
      ? say(String(req.messages.at(-1)?.content))
      : callTool("notes", "search_owner_notes", { query: "delivery" }),
  );
  const env = await startCore({ llm });
  try {
    const { project } = await env.client.call("projects.create", { name: "Acme delivery" });
    const agent = await env.client.call("agents.create", {
      project_id: project.id,
      slug: "delivery",
      name: "Delivery",
    });
    const other = await env.client.call("agents.create", { project_id: project.id, slug: "billing", name: "Billing" });
    const { project: foreign } = await env.client.call("projects.create", { name: "Northwind" });
    const person = await env.client.call("contacts.set", {
      name: "Acme Buyer",
      agent_id: agent.id,
      perms: { notes: true },
    });
    const thread = env.core.store.threads.create({
      kind: "channel",
      title: person.name,
      agent_ids: [agent.id],
      project_id: project.id,
      channel: { id: "test", conversation: person.id, person_id: person.id },
    });
    const save = (
      text: string,
      scope: "project" | "agent" | "global",
      project_id?: string,
      agent_id?: string,
      pending = false,
    ) => env.core.store.memories.add({ text, scope, project_id, agent_id, source: "agent", tainted: true, pending });
    save("Delivery project approved destination", "project", project.id);
    save("Delivery notebook approved schedule", "agent", project.id, agent.id);
    save("Delivery foreign project secret", "project", foreign.id);
    save("Delivery foreign notebook secret", "agent", project.id, other.id);
    save("Delivery unscoped notebook secret", "agent", undefined, agent.id);
    save("Delivery global automatic secret", "global");
    save("Delivery pending secret", "project", project.id, undefined, true);
    const forgotten = save("Delivery forgotten secret", "project", project.id);
    await env.client.call("memory.remove", { id: forgotten.id });
    const ask = async () => {
      await env.client.call("threads.send", { thread: thread.id, text: "What is the delivery schedule?" });
      const settled = await env.settle(thread.id);
      const run = settled.runs[0];
      assert.equal(run?.state, "completed");
      return env.core.store.runs.steps(run?.id ?? "").find((s) => s.tool === "search_owner_notes");
    };
    const result = (await ask())?.result ?? "";
    assert.match(result, /approved destination/);
    assert.match(result, /approved schedule/);
    assert.doesNotMatch(result, /secret/);
    assert.match(result, /contact_notes trust="untrusted"/);
    assert.match(String(llm.calls[0]?.messages[0]?.content), /You are Delivery/);
    assert.match(String(llm.calls[0]?.messages[0]?.content), /use search_owner_notes before saying you do not know/);
    assert.ok(
      llm.calls.every(
        (c) => !c.tools?.some((t) => ["recall", "read_chat", "delegate", "shell"].includes(t.function.name)),
      ),
    );
    await env.client.call("contacts.set", { id: person.id, name: person.name, perms: { notes: false } });
    const denied = (await ask())?.result ?? "";
    assert.doesNotMatch(denied, /approved destination|approved schedule/);
    assert.ok(!llm.calls.at(-1)?.tools?.some((t) => t.function.name === "search_owner_notes"));
    await env.client.call("contacts.set", {
      id: person.id,
      name: person.name,
      perms: { notes: true },
      agent_id: other.id,
    });
    const reassigned = (await ask())?.result ?? "";
    assert.doesNotMatch(reassigned, /approved destination|approved schedule/);
    await env.client.call("contacts.set", { id: person.id, name: person.name, agent_id: null });
    assert.doesNotMatch((await ask())?.result ?? "", /approved destination|approved schedule/);
    await env.client.call("contacts.set", { id: person.id, name: person.name, agent_id: agent.id });
    const settings = await env.client.call("memory.settings", {});
    await env.client.call("memory.set_settings", { mode: "off", auto_compact: settings.auto_compact });
    assert.doesNotMatch((await ask())?.result ?? "", /approved destination|approved schedule/);
    assert.ok(!llm.calls.at(-1)?.tools?.some((t) => t.function.name === "search_owner_notes"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("WhatsApp inbound answers as the assigned project agent from its notebook and loses lookup on revocation", async () => {
  const wa = fakeWhatsApp();
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool
      ? say(String(req.messages.at(-1)?.content))
      : callTool("notes", "search_owner_notes", { query: "delivery" }),
  );
  const env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: `${env.home}/wa`, selfOwner: c.self_owner === true, lib: async () => wa.lib }),
    },
  });
  try {
    const { project } = await env.client.call("projects.create", { name: "Acme delivery" });
    const agent = await env.client.call("agents.create", {
      name: "Delivery",
      slug: "delivery",
      project_id: project.id,
    });
    const person = await env.client.call("contacts.set", {
      name: "Acme Buyer",
      agent_id: agent.id,
      perms: { notes: true, any_hour: true },
    });
    await env.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", agent_id: "superagent", self_owner: true },
    });
    const channel = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
    await waitFor(async () => Boolean((await channel())?.qr), "QR to scan");
    wa.scan();
    await waitFor(async () => (await channel())?.status === "running", "linked");
    const buyer = { name: "Acme Buyer", phone: "5491100000002@s.whatsapp.net" };
    await env.client.call("contacts.address", { person: person.id, channel: "whatsapp", address: buyer.phone });
    env.core.store.memories.add({
      text: "Delivery approved: the package arrives Tuesday.",
      scope: "agent",
      project_id: project.id,
      agent_id: agent.id,
      source: "agent",
      tainted: true,
    });
    wa.message(buyer, "What is the delivery schedule?");
    await waitFor(
      () => wa.sent.some((s) => String(s.content.text).includes("package arrives Tuesday")),
      "notebook answer sent",
    );
    const thread = env.core.store.threads.list().find((t) => t.channel?.person_id === person.id);
    assert.ok(thread);
    assert.deepEqual(thread.agent_ids, [agent.id]);
    assert.equal(thread.project_id, project.id);
    assert.match(String(llm.calls[0]?.messages[0]?.content), /You are Delivery/);
    await env.client.call("contacts.set", { id: person.id, name: person.name, perms: { notes: false } });
    const before = wa.sent.length;
    wa.message(buyer, "What is the delivery schedule again?");
    await waitFor(() => wa.sent.length > before, "reply without notes");
    assert.doesNotMatch(
      wa.sent
        .slice(before)
        .map((s) => s.content.text)
        .join("\n"),
      /package arrives Tuesday/,
    );
    assert.deepEqual(llm.calls.at(-1)?.tools ?? [], []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
