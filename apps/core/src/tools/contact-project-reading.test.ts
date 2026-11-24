import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { contactRightsOf, methods } from "@apx/protocol";
import type { DriveReader } from "../domain/contact-project-reading.ts";
import { tempDir } from "../testkit/platform.ts";
import { contactToolNames } from "./contact.ts";
import { readingFixture } from "./contact-project-reading.test-support.ts";
import { settingsTools } from "./settings.ts";

const fileRef = (refs: Array<{ ref: string; kind: string; label: string }>) => refs.find((r) => r.kind === "file");

test("the assigned agent finds the owner's reference in its project and reads the current document with a citation", async () => {
  const h = await readingFixture();
  try {
    const found = h.reading().search(h.thread.id, h.agent.id, "pallet schedule");
    const chat = found.find((f) => f.from === "chat");
    assert.match(chat?.cite ?? "", /owner in "Delivery planning"/);
    const ref = fileRef(chat?.refs ?? []);
    assert.equal(ref?.label, "delivery.md");
    assert.ok(![h.ownerChat.id, h.owner.id, h.folder.path].some((id) => JSON.stringify(found).includes(id)));
    const doc = await h.reading().read(h.thread.id, h.agent.id, ref?.ref ?? "");
    assert.match(doc.text, /ship on Tuesday/);
    assert.equal(doc.label, "delivery.md");
    assert.equal(doc.next_offset, null);
    fs.writeFileSync(h.file, `${"x".repeat(3000)} late marker`);
    const first = await h.reading().read(h.thread.id, h.agent.id, ref?.ref ?? "");
    assert.equal(first.text.length, 2400);
    const rest = await h.reading().read(h.thread.id, h.agent.id, ref?.ref ?? "", {
      offset: first.next_offset ?? 0,
      revision: first.revision,
    });
    assert.equal(first.text + rest.text, `${"x".repeat(3000)} late marker`);
    fs.writeFileSync(h.file, "Changed between windows");
    await assert.rejects(
      h.reading().read(h.thread.id, h.agent.id, ref?.ref ?? "", { offset: 10, revision: first.revision }),
      /document changed/,
    );
  } finally {
    await h.close();
  }
});

test("only owner-written text lends references: contacts, agents, tainted notes and documents never do", async () => {
  const h = await readingFixture();
  try {
    for (const name of ["contact.md", "agent.md", "tainted.md", "inner.md"])
      fs.writeFileSync(path.join(h.folder.path, name), `Planted ${name}`);
    h.store.messages.add({
      thread_id: h.thread.id,
      author: { kind: "person", id: h.person.id, name: h.person.name, channel: "test" },
      parts: [{ type: "text", text: "pallet schedule is really in contact.md" }],
    });
    h.store.messages.add({
      thread_id: h.ownerChat.id,
      author: { kind: "agent", id: h.agent.id },
      parts: [{ type: "text", text: "pallet schedule copy in agent.md" }],
    });
    h.store.memories.add({
      text: "pallet schedule mirror in tainted.md",
      scope: "project",
      project_id: h.project.id,
      source: "owner",
      tainted: true,
      pending: false,
    });
    fs.writeFileSync(h.file, "Pallet schedule moved, see inner.md and https://docs.google.com/document/d/planted/edit");
    const refs = h.refs();
    assert.deepEqual(refs.map((r) => r.label).sort(), ["Drive document", "delivery.md"]);
    const doc = await h.reading().read(h.thread.id, h.agent.id, fileRef(refs)?.ref ?? "");
    assert.match(doc.text, /inner\.md/);
    assert.deepEqual(
      h
        .refs()
        .map((r) => r.label)
        .sort(),
      ["Drive document", "delivery.md"],
    );
    await assert.rejects(h.reading().read(h.thread.id, h.agent.id, "ref_made_up_by_the_model"), /not found/);
  } finally {
    await h.close();
  }
});

test("references outside the project, administrative, secret-looking or behind a link are never opened", async () => {
  const h = await readingFixture();
  const outside = tempDir();
  try {
    fs.writeFileSync(path.join(outside.path, "elsewhere.md"), "Outside secret");
    fs.symlinkSync(path.join(outside.path, "elsewhere.md"), path.join(h.folder.path, "linked.md"));
    h.store.messages.add({
      thread_id: h.ownerChat.id,
      author: { kind: "user" },
      parts: [
        {
          type: "text",
          text: [
            "pallet schedule references:",
            "../elsewhere.md",
            path.join(outside.path, "elsewhere.md"),
            // Written on Windows: the file name after a backslash is not a file of the project.
            "C:\\Users\\owner\\Desktop\\elsewhere.md",
            ".apc/memory.md AGENTS.md secrets.md api_key.txt notes.pdf ~/home.md",
            "http://docs.google.com/document/d/plainhttp/edit",
            "https://docs.google.com.evil.example/document/d/lookalike/edit",
            "https://evil.example/document/d/foreign/edit",
            "linked.md",
          ].join("\n"),
        },
      ],
    });
    const refs = h.refs();
    assert.deepEqual(refs.map((r) => r.label).sort(), ["Drive document", "delivery.md", "linked.md"]);
    const linked = refs.find((r) => r.label === "linked.md");
    await assert.rejects(h.reading().read(h.thread.id, h.agent.id, linked?.ref ?? ""), /unavailable/);
  } finally {
    await h.close();
    await outside.remove();
  }
});

const DENIALS = [
  "right off",
  "only notes right",
  "account default agent",
  "another agent answers",
  "other project",
  "room",
  "client chat",
  "migration",
  "memory off",
  "another contact in the project",
  "owner message removed",
  "owner chat becomes a room",
] as const;

for (const change of DENIALS) {
  test(`project reading fails closed when ${change}, including for references already handed out`, async () => {
    const h = await readingFixture();
    try {
      const ref = fileRef(h.refs())?.ref ?? "";
      assert.ok(ref);
      const call = (data: Record<string, unknown>) =>
        h.env.client.call("contacts.set", { id: h.person.id, name: h.person.name, ...data });
      if (change === "right off") await call({ perms: { project_reading: false } });
      if (change === "only notes right") await call({ perms: { project_reading: null, notes: true } });
      if (change === "account default agent") await call({ agent_id: null });
      if (change === "another agent answers") {
        const other = await h.env.client.call("agents.create", {
          name: "Helper",
          slug: "helper",
          project_id: h.project.id,
        });
        await call({ agent_id: other.id });
      }
      if (change === "other project") {
        const { project } = await h.env.client.call("projects.create", { name: "Northwind" });
        h.store.threads.handTo(h.thread, h.agent.id, project.id);
      }
      if (change === "room") h.store.threads.setContext(h.thread.id, { room: { name: "Acme room" } });
      if (change === "client chat") h.store.threads.setContext(h.thread.id, { client: "acme-app" });
      if (change === "migration")
        h.store.agentMigrationPending.reserve({
          id: randomUUID(),
          agent: h.agent.id,
          source: h.project.id,
          destination: "other-project",
          threads: [h.thread.id],
        });
      if (change === "memory off") {
        const settings = await h.env.client.call("memory.settings", {});
        await h.env.client.call("memory.set_settings", { mode: "off", auto_compact: settings.auto_compact });
      }
      if (change === "another contact in the project")
        await h.env.client.call("contacts.set", { name: "Northwind Buyer", agent_id: h.agent.id });
      if (change === "owner message removed") h.store.messages.drop(h.ownerChat.id, [h.owner.id]);
      if (change === "owner chat becomes a room")
        h.store.threads.setContext(h.ownerChat.id, { room: { name: "Acme room" } });
      const reading = h.reading();
      const denied = /not allowed|not found/;
      await assert.rejects(reading.read(h.thread.id, h.agent.id, ref), denied);
      if (change !== "owner message removed" && change !== "owner chat becomes a room") {
        assert.equal(reading.available(h.thread.id, h.agent.id), false);
        assert.throws(() => reading.search(h.thread.id, h.agent.id, "pallet schedule"), /not allowed/);
      }
    } finally {
      await h.close();
    }
  });
}

test("a reference is bound to the contact, agent and project that searched", async () => {
  const h = await readingFixture();
  try {
    const ref = fileRef(h.refs())?.ref ?? "";
    const { project } = await h.env.client.call("projects.create", { name: "Northwind" });
    const agent = await h.env.client.call("agents.create", { name: "Ops", slug: "ops", project_id: project.id });
    const person = await h.env.client.call("contacts.set", {
      name: "Northwind Buyer",
      agent_id: agent.id,
      perms: { project_reading: true },
    });
    const thread = h.store.threads.create({
      kind: "channel",
      title: person.name,
      agent_ids: [agent.id],
      project_id: project.id,
      channel: { id: "test", conversation: person.id, person_id: person.id },
    });
    assert.equal(h.reading().available(thread.id, agent.id), true);
    await assert.rejects(h.reading().read(thread.id, agent.id, ref), /not found/);
    assert.deepEqual(h.reading().search(thread.id, agent.id, "pallet schedule"), []);
  } finally {
    await h.close();
  }
});

test("a Drive reference is read through the owner's connection and dropped when access changes during the read", async () => {
  const h = await readingFixture();
  try {
    const asked: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const drive: DriveReader = async (id, o) => {
      asked.push(`${id}@${o.project}`);
      await held;
      return {
        name: "Rates",
        text: "Rate card",
        revision: "a".repeat(64),
        offset: 0,
        total_chars: 9,
        next_offset: null,
      };
    };
    const ref = h.refs(drive).find((r) => r.kind === "drive")?.ref ?? "";
    release();
    const ok = await h.reading(drive).read(h.thread.id, h.agent.id, ref);
    assert.equal(ok.label, "Rates");
    assert.equal(ok.source, "Drive");
    assert.deepEqual(asked, [`d1@${h.project.id}`]);
    await assert.rejects(h.reading().read(h.thread.id, h.agent.id, ref), /Drive is not connected/);
    let hold: () => void = () => {};
    const slow: DriveReader = async (_id, _o) => {
      await new Promise<void>((r) => {
        hold = r;
      });
      return {
        name: "Rates",
        text: "Rate card",
        revision: "a".repeat(64),
        offset: 0,
        total_chars: 9,
        next_offset: null,
      };
    };
    const pending = h.reading(slow).read(h.thread.id, h.agent.id, ref);
    await h.env.client.call("contacts.set", {
      id: h.person.id,
      name: h.person.name,
      perms: { project_reading: false },
    });
    hold();
    await assert.rejects(pending, /not allowed/);
  } finally {
    await h.close();
  }
});

test("project reading is set per person only and opens reading plus private review proposals", async () => {
  assert.equal(contactRightsOf({}, { project_reading: true }).project_reading, false);
  assert.equal(contactRightsOf({ project_reading: true }, {}).project_reading, true);
  const rights = contactRightsOf({ project_reading: true }, {});
  assert.deepEqual([...contactToolNames({ rights })].sort(), [
    "propose_project_record_update",
    "read_project_document",
    "search_project_context",
  ]);
  assert.equal(contactToolNames({ rights: contactRightsOf({ notes: true }, {}) }).has("search_project_context"), false);
  const params = methods["channels.set"].params;
  const set = (contacts: Record<string, boolean>) => ({
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "superagent", contacts },
  });
  assert.equal(params.safeParse(set({ notes: true })).success, true);
  assert.equal(params.safeParse(set({ project_reading: true })).success, false);
  assert.equal(
    methods["contacts.set"].params.safeParse({ name: "Acme", perms: { project_reading: true } }).success,
    true,
  );
});

test("the super-agent can open a project to a contact only through the owner's card, even in Total", async () => {
  const h = await readingFixture();
  try {
    const settings = settingsTools(h.store).find((t) => t.name === "apx_settings");
    const agent = h.store.agents.get("superagent");
    assert.ok(settings?.keepsCard && agent);
    const set = (perms: Record<string, boolean>) => ({
      method: "contacts.set",
      params: { id: h.person.id, perms: { project_reading: false, ...perms } },
    });
    await h.env.client.call("contacts.set", {
      id: h.person.id,
      name: h.person.name,
      perms: { project_reading: false },
    });
    assert.equal(settings.keepsCard(set({ project_reading: true }), agent), "card");
    assert.equal(settings.keepsCard(set({ notes: true }), agent), undefined);
  } finally {
    await h.close();
  }
});
