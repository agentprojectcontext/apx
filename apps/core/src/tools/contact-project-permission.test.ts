import assert from "node:assert/strict";
import { test } from "node:test";
import { readingFixture } from "./contact-project-reading.test-support.ts";

for (const next of ["another agent", "account default"] as const) {
  test(`changing to ${next} revokes project reading without changing the notes right`, async () => {
    const h = await readingFixture();
    try {
      const helper = await h.env.client.call("agents.create", {
        name: "Helper",
        slug: "helper",
        project_id: h.project.id,
      });
      const set = (data: { agent_id?: string | null; perms?: { notes?: boolean; project_reading?: boolean } }) =>
        h.env.client.call("contacts.set", { id: h.person.id, name: h.person.name, ...data });
      await set({ perms: { notes: true } });
      const changed = await set({ agent_id: next === "another agent" ? helper.id : null });
      assert.equal(changed.perms.project_reading, false);
      assert.equal(changed.perms.notes, true);
      await set({ agent_id: h.agent.id });
      assert.equal(h.reading().available(h.thread.id, h.agent.id), false);
      await set({ perms: { project_reading: true } });
      assert.equal(h.reading().available(h.thread.id, h.agent.id), true);
    } finally {
      await h.close();
    }
  });
}

test("joining people assigned to different agents does not transfer either project authorization", async () => {
  const h = await readingFixture();
  try {
    const { project } = await h.env.client.call("projects.create", { name: "Northwind" });
    const otherAgent = await h.env.client.call("agents.create", {
      name: "Helper",
      slug: "helper",
      project_id: project.id,
    });
    const other = await h.env.client.call("contacts.set", {
      name: "Other buyer",
      agent_id: otherAgent.id,
      perms: { project_reading: true },
    });
    h.store.persons.link(h.person.id, { channel: "test", external_id: "buyer-first" });
    h.store.persons.link(other.id, { channel: "test", external_id: "buyer-second" });
    assert.equal(h.store.persons.joinPeople("test", "buyer-first", "buyer-second"), true);
    assert.equal(h.store.persons.get(other.id)?.perms.project_reading, false);
  } finally {
    await h.close();
  }
});

test("committing a project migration revokes consultation without restoring it on recovery", async () => {
  const h = await readingFixture();
  try {
    const { project } = await h.env.client.call("projects.create", { name: "Northwind" });
    h.store.threads.remove([h.thread.id]);
    const inventory = h.store.agentMigration.inventory(h.agent.id, project.id);
    assert.deepEqual(inventory.blockers, []);
    const moved = h.store.agentMigration.commit(inventory);
    assert.equal(h.store.persons.get(h.person.id)?.perms.project_reading, false);
    h.store.agentMigration.restore(moved.id);
    assert.equal(h.store.agents.get(h.agent.id)?.project_id, h.project.id);
    assert.equal(h.store.persons.get(h.person.id)?.perms.project_reading, false);
  } finally {
    await h.close();
  }
});

for (const source of ["local", "apc"] as const) {
  test(`moving a ${source} agent to another project revokes the former authorization permanently`, async () => {
    const h = await readingFixture();
    try {
      const { project } = await h.env.client.call("projects.create", { name: "Northwind" });
      const agent = h.store.agents.get(h.agent.id);
      assert.ok(agent);
      const move = (project_id: string) => {
        if (source === "local") h.store.agents.upsert({ ...agent, project_id });
        else
          h.store.agents.upsertApc({
            id: agent.id,
            slug: "delivery",
            name: agent.name,
            role: agent.role,
            prompt: agent.prompt,
            project_id,
            extra: {},
          });
      };
      move(project.id);
      assert.equal(h.store.persons.get(h.person.id)?.perms.project_reading, false);
      move(h.project.id);
      assert.equal(h.reading().available(h.thread.id, agent.id), false);
      await h.env.client.call("contacts.set", {
        id: h.person.id,
        name: h.person.name,
        perms: { project_reading: true },
      });
      assert.equal(h.reading().available(h.thread.id, agent.id), true);
    } finally {
      await h.close();
    }
  });
}
