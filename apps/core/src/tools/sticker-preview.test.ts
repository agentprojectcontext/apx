import assert from "node:assert/strict";
import { test } from "node:test";
import { previewOf } from "../domain/threads.ts";
import { agentTools } from "./agents.ts";
import { readingFixture } from "./contact-project-reading.test-support.ts";
import { requestTools } from "./requests.ts";
import { untrusted } from "./result.ts";
import type { ToolContext } from "./types.ts";

const raw = '<sticker named_by="a model that saw it" trust="untrusted">\n[sticker: fox]\n</sticker>';

test("display projections do not change persisted previews, contact requests or session tool input", async (t) => {
  const h = await readingFixture();
  try {
    const person = h.store.persons.create({ name: "Waiting visitor", role: "contact", unreviewed: true });
    h.store.persons.link(person.id, { channel: "test", external_id: "visitor" });
    const thread = h.store.threads.create({
      kind: "channel",
      title: person.name,
      agent_ids: [h.agent.id],
      channel: { id: "test", conversation: "visitor", person_id: person.id },
    });
    const session = h.store.threads.create({
      kind: "a2a",
      title: "Review",
      agent_ids: [h.agent.id],
      parent_id: h.ownerChat.id,
      session: "review",
    });
    for (const id of [thread.id, session.id]) {
      h.store.messages.add({ thread_id: id, author: { kind: "user" }, parts: [{ type: "text", text: raw }] });
      h.store.threads.settle(id, "2026-01-01T00:00:00.000Z", raw);
      await t.test(`source preview for ${id === thread.id ? "contact" : "session"}`, async () => {
        assert.equal(previewOf(raw), raw.slice(0, 160), "new previews keep the source text");
        assert.equal(h.store.threads.get(id)?.preview, raw.slice(0, 160));
        const result = await h.env.client.call("threads.get", { thread: id });
        assert.equal(result.thread.preview, raw.slice(0, 160));
        assert.ok(result.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === raw)));
      });
    }
    const ctx = { thread: h.ownerChat } as unknown as ToolContext;
    for (const [tools, name] of [
      [requestTools(h.store), "contact_requests"],
      [agentTools(h.store), "list_sessions"],
    ] as const) {
      await t.test(name, async () => {
        const tool = tools.find((tool) => tool.name === name);
        assert.ok(tool);
        const result = String(await tool.run({}, ctx));
        const expected =
          name === "contact_requests"
            ? untrusted("contact_request", { contact: person.id }, `name: ${person.name}\nlast message: ${raw}`)
            : raw;
        assert.ok(result.includes(expected), `${name} keeps its existing source text and escaping: ${result}`);
      });
    }
  } finally {
    await h.close();
  }
});
