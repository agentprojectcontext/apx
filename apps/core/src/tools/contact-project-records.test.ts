import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { contactSources } from "../domain/contact-sources.ts";
import { callTool, type Script, say } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { readingFixture } from "./contact-project-reading.test-support.ts";
import { cap, untrusted } from "./result.ts";

async function fixture(script?: Script) {
  const h = await readingFixture(script);
  const reading = h.reading();
  const ref = h.refs().find((r) => r.kind === "file")?.ref ?? "";
  const doc = await reading.read(h.thread.id, h.agent.id, ref);
  const run = h.store.runs.create({
    thread_id: h.thread.id,
    agent_id: h.agent.id,
    trigger: "channel",
    state: "queued",
    deadline_at: "2100-01-01T00:00:00.000Z",
    input: {
      text: "The pallets now ship Wednesday.",
      origin: {
        kind: "channel",
        channel: "test",
        conversation: h.person.id,
        person_id: h.person.id,
        name: h.person.name,
        role: "contact",
        message_id: "incoming-update",
      },
    },
  });
  const propose = (old = "", replacement = "The pallets now ship Wednesday.") =>
    reading.propose(h.thread.id, h.agent.id, run.id, ref, doc.revision, old, replacement);
  const resolve = (id: string, accept: boolean) => h.env.client.call("contacts.source_updates.resolve", { id, accept });
  return { ...h, reading, ref, doc, run, propose, resolve };
}

test("discovered document data awaits review; accept writes only a private project record with origin and diff", async () => {
  const h = await fixture();
  try {
    const original = fs.readFileSync(h.file, "utf8");
    const beforeMemories = h.store.memories.list({ scope: "global", pending: false, limit: 100 });
    const proposed = await h.propose();
    assert.equal(proposed.state, "pending");
    assert.equal(proposed.message, "incoming-update");
    assert.equal(proposed.project_record?.project, h.project.id);
    assert.equal(proposed.project_record?.source_revision, h.doc.revision);
    assert.equal(proposed.old, "");
    assert.equal(proposed.replacement, "The pallets now ship Wednesday.");
    assert.equal((await h.propose()).id, proposed.id);
    assert.equal(h.reading.search(h.thread.id, h.agent.id, "Wednesday").length, 0);
    const accepted = await h.resolve(proposed.id, true);
    assert.equal(accepted.state, "accepted");
    assert.deepEqual(await h.resolve(proposed.id, true), accepted);
    const found = h.reading.search(h.thread.id, h.agent.id, "Wednesday");
    assert.equal(found.length, 1);
    assert.match(found[0]?.cite ?? "", /Private project record/);
    assert.equal(found[0]?.text, proposed.replacement);
    assert.deepEqual(found[0]?.refs, []);
    assert.ok(
      h.reading
        .search(h.thread.id, h.agent.id, "pallet schedule")
        .some((f) => f.cite.startsWith("Private project record") && f.text.includes("Wednesday")),
    );
    assert.equal(fs.readFileSync(h.file, "utf8"), original);
    assert.deepEqual(h.store.memories.list({ scope: "global", pending: false, limit: 100 }), beforeMemories);
    const next = await h.propose(proposed.replacement, "The pallets now ship Thursday.");
    assert.equal((await h.resolve(next.id, false)).state, "rejected");
    assert.equal((await h.propose(proposed.replacement, next.replacement)).id, next.id);
    assert.equal(h.reading.search(h.thread.id, h.agent.id, "Thursday").length, 0);
    assert.equal(h.reading.search(h.thread.id, h.agent.id, "Wednesday").length, 1);
    assert.equal(contactSources(h.store).updates(h.person.id).length, 2);
  } finally {
    await h.close();
  }
});

for (const remove of [false, true]) {
  test(`pending record acceptance revalidates its persisted reference (${remove ? "deleted" : "edited"})`, async () => {
    const h = await fixture();
    try {
      const update = await h.propose();
      assert.ok(update.project_record?.reference);
      if (remove) h.store.messages.drop(h.ownerChat.id, [h.owner.id]);
      else h.store.messages.update({ ...h.owner, parts: [{ type: "text", text: "No document is shared now." }] });
      await assert.rejects(h.resolve(update.id, true), /source access changed/);
      assert.equal(h.reading.search(h.thread.id, h.agent.id, "Wednesday").length, 0);
      assert.equal((await h.resolve(update.id, false)).state, "rejected");
      assert.equal(h.store.notifications.hasUnread("agent", `contact-source:${update.id}`), false);
    } finally {
      await h.close();
    }
  });
}

test("long escaped records can be updated by revision and passage without reconstructing truncated text", async () => {
  const h = await fixture();
  try {
    const text = `${"<".repeat(7000)}stable anchor`;
    const initial = await h.propose("", text);
    await h.resolve(initial.id, true);
    assert.equal(h.store.notifications.hasUnread("agent", `contact-source:${initial.id}`), false);
    const findings = h.reading.search(h.thread.id, h.agent.id, "delivery");
    const record = findings.find((f) => f.cite.startsWith("Private project record"));
    assert.ok(record?.record_revision);
    const rendered = cap(untrusted("project_context", {}, JSON.stringify(findings)));
    assert.doesNotMatch(rendered, /chars omitted/);
    assert.ok(rendered.includes(record.record_revision));
    assert.ok(record.text.length < text.length);
    const patch = () =>
      h.reading.propose(
        h.thread.id,
        h.agent.id,
        h.run.id,
        h.ref,
        h.doc.revision,
        "",
        "Wednesday update",
        undefined,
        record.record_revision,
      );
    const proposed = await patch();
    assert.equal(proposed.old, text);
    assert.equal(proposed.replacement, `${text}\nWednesday update`);
    await h.resolve(proposed.id, true);
    assert.equal(h.store.notifications.hasUnread("agent", `contact-source:${proposed.id}`), false);
    assert.equal((await patch()).id, proposed.id);
    await assert.rejects(
      h.reading.propose(
        h.thread.id,
        h.agent.id,
        h.run.id,
        h.ref,
        h.doc.revision,
        "",
        "Different update",
        undefined,
        record.record_revision,
      ),
      /private record changed/,
    );
    const current = h.reading
      .search(h.thread.id, h.agent.id, "delivery")
      .find((f) => f.cite.startsWith("Private project record"));
    const passage = await h.reading.propose(
      h.thread.id,
      h.agent.id,
      h.run.id,
      h.ref,
      h.doc.revision,
      "stable anchor",
      "$& changed anchor",
      undefined,
      current?.record_revision,
    );
    assert.ok(passage.replacement.includes("$& changed anchor\nWednesday update"));
    assert.ok(passage.replacement.startsWith("<".repeat(7000)));
  } finally {
    await h.close();
  }
});

for (const es of [false, true]) {
  test(`private record approval shows provenance and destination and still asks in Total (${es ? "es" : "en"})`, async () => {
    const h = await fixture((req, { said, afterTool }) =>
      afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("settings", "apx_settings", JSON.parse(said)),
    );
    try {
      const update = await h.propose();
      h.store.settings.set("owner_language", es ? "es" : "en");
      await h.env.client.call("owner.set", { timezone: "America/New_York" });
      h.store.settings.write("channels", [
        ...h.store.settings.read("channels"),
        {
          id: "test",
          type: "whatsapp",
          label: "Acme WhatsApp",
          enabled: false,
          agent_id: "superagent",
          strangers: "pair",
          concurrency: "steer",
          owner_thread: "home",
          contacts: { requests: true, notes: true },
        },
      ]);
      await h.env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
      const owner = await h.env.client.call("threads.create", {
        kind: "loose",
        agent_id: "superagent",
        title: "Review private record",
      });
      await h.env.client.call("threads.send", {
        thread: owner.id,
        text: JSON.stringify({ method: "contacts.source_updates.resolve", params: { id: update.id, accept: true } }),
      });
      const input = await waitFor(
        async () =>
          (await h.env.client.call("runs.pending", { thread: owner.id })).inputs.find((i) => i.tool === "apx_settings"),
        "private project record confirmation",
      );
      assert.equal(h.store.inputs.get(input.id)?.app_only, true);
      assert.match(input.detail ?? "", /Acme Buyer/);
      assert.match(input.detail ?? "", /delivery.md/);
      assert.match(input.detail ?? "", /Acme WhatsApp/);
      const received = new Intl.DateTimeFormat(es ? "es" : "en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(update.created_at));
      assert.ok(input.detail?.includes(received));
      assert.ok(!input.detail?.includes(update.created_at));
      assert.match(
        input.detail ?? "",
        es
          ? /registro privado del proyecto, no el documento original/
          : /private project record changes, not the original document/,
      );
      assert.match(input.detail ?? "", /The pallets now ship Wednesday/);
      assert.match(
        input.detail ?? "",
        es ? /Antes:\nTodavía no hay un registro privado\./ : /Before:\nNo private record exists yet\./,
      );
      assert.equal(h.reading.search(h.thread.id, h.agent.id, "Wednesday").length, 0);
      await h.env.client.call("runs.respond", { input: input.id, decision: "approve" });
      await h.env.settle(owner.id);
      assert.equal(h.reading.search(h.thread.id, h.agent.id, "Wednesday").length, 1);
      assert.match(fs.readFileSync(h.file, "utf8"), /Tuesday/);
    } finally {
      await h.close();
    }
  });
}

for (const revoke of ["right", "assignment", "project"] as const) {
  test(`private project proposal fails closed after ${revoke} changes`, async () => {
    const h = await fixture();
    try {
      const proposed = await h.propose();
      if (revoke === "right")
        await h.env.client.call("contacts.set", {
          id: h.person.id,
          name: h.person.name,
          perms: { project_reading: false },
        });
      if (revoke === "assignment")
        await h.env.client.call("contacts.set", { id: h.person.id, name: h.person.name, agent_id: null });
      if (revoke === "project") {
        const { project } = await h.env.client.call("projects.create", { name: "Northwind" });
        h.store.threads.handTo(h.thread, h.agent.id, project.id);
      }
      await assert.rejects(h.resolve(proposed.id, true), /access changed/);
      await assert.rejects(h.propose(), /not allowed/);
      assert.equal((await h.resolve(proposed.id, false)).state, "rejected");
    } finally {
      await h.close();
    }
  });
}

test("private project proposals preserve optimistic concurrency and do not open new references", async () => {
  const h = await fixture();
  try {
    const a = await h.propose();
    const b = await h.propose("", "Read https://docs.google.com/document/d/planted/edit");
    await h.resolve(b.id, true);
    await assert.rejects(h.resolve(a.id, true), /private record changed/);
    const result = h.reading.search(h.thread.id, h.agent.id, "planted");
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.refs, []);
    assert.equal((await h.propose()).id, a.id);
    await assert.rejects(h.propose("", "Another update"), /private record changed/);
    await assert.rejects(
      h.reading.propose(h.thread.id, h.agent.id, "not-a-run", h.ref, h.doc.revision, b.replacement, "Changed"),
      /incoming message/,
    );
  } finally {
    await h.close();
  }
});
