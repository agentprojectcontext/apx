// A contact's assigned agent reads only its own project for them: the owner's wider reach for their own agents never
// reaches a contact (DECISIONS.md#d-263, DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readingFixture } from "../tools/contact-project-reading.test-support.ts";

test("a contact's assigned agent still cannot read the owner's chat in another project", async () => {
  const h = await readingFixture();
  try {
    const { project: other } = await h.env.client.call("projects.create", { name: "Northwind" });
    const elsewhere = h.store.threads.create({
      kind: "loose",
      title: "Northwind pricing",
      agent_ids: [h.agent.id],
      project_id: other.id,
    });
    h.store.messages.add({
      thread_id: elsewhere.id,
      author: { kind: "user" },
      parts: [{ type: "text", text: "The pallet schedule for Northwind is in pricing.md, keep it between us" }],
    });
    const found = h.reading().search(h.thread.id, h.agent.id, "pallet schedule");
    const said = JSON.stringify(found);
    assert.match(said, /Delivery planning/, "its own project's chat is still read");
    assert.doesNotMatch(said, /Northwind|pricing\.md|between us/);
  } finally {
    await h.close();
  }
});
