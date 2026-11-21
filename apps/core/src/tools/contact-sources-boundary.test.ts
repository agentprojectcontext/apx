import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sourceFixture } from "./contact-sources.test-support.ts";

test("a source cannot follow a directory link at grant time or after it was authorized", async () => {
  const h = await sourceFixture();
  try {
    const outside = path.join(h.env.home, "outside-project");
    const nested = path.join(h.folder.path, "nested");
    fs.mkdirSync(outside);
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(outside, "record.md"), "Forbidden other-project marker");
    fs.writeFileSync(path.join(nested, "record.md"), "Authorized marker");
    const granted = await h.env.client.call("contacts.sources.set", { ...h.params, path: "nested/record.md" });
    fs.renameSync(nested, path.join(h.folder.path, "saved"));
    fs.symlinkSync(outside, nested, "junction");
    await assert.rejects(
      h.env.client.call("contacts.sources.set", { ...h.params, path: "nested/record.md" }),
      /unavailable or changed/,
    );
    const response = JSON.stringify(h.repo.consult(h.thread.id, h.agent.id, "", granted.id));
    assert.match(response, /unavailable/);
    assert.doesNotMatch(response, /Forbidden|outside-project/);
  } finally {
    await h.close();
  }
});

test("corrections require the matching incoming contact run, exact passage and reviewed version; caps do not break deduplication", async () => {
  const h = await sourceFixture();
  try {
    const run = h.run();
    const args = [h.thread.id, h.agent.id, run.id, h.source.id, h.source.revision] as const;
    assert.throws(() => h.repo.propose(...args, "missing passage", "new data"), /exact passage/);
    assert.throws(
      () =>
        h.repo.propose(h.thread.id, h.agent.id, "missing-run", h.source.id, h.source.revision, "Tuesday", "Wednesday"),
      /incoming message/,
    );
    assert.throws(
      () => h.repo.propose(h.thread.id, h.agent.id, run.id, h.source.id, "wrong-revision", "Tuesday", "Wednesday"),
      /source changed/,
    );
    const other = await h.env.client.call("contacts.set", { name: "Northwind Buyer", agent_id: h.agent.id });
    const foreign = await h.env.client.call("contacts.sources.set", { ...h.params, person: other.id });
    assert.throws(
      () => h.repo.propose(h.thread.id, h.agent.id, run.id, foreign.id, foreign.revision, "Tuesday", "Wednesday"),
      /authorized source/,
    );
    const updates = Array.from({ length: 5 }, (_, n) => h.repo.propose(...args, "Tuesday", `Updated day ${n}`));
    assert.throws(() => h.repo.propose(...args, "Tuesday", "One more day"), /already await the owner/);
    assert.equal(h.repo.propose(...args, "Tuesday", "Updated day 0").id, updates[0]?.id);
    assert.equal(h.repo.updates(h.person.id).length, 5);
    assert.match(fs.readFileSync(h.file, "utf8"), /Tuesday/);
  } finally {
    await h.close();
  }
});

test("disabling memory disables document consultation and new proposals", async () => {
  const h = await sourceFixture();
  try {
    const settings = await h.env.client.call("memory.settings", {});
    await h.env.client.call("memory.set_settings", { mode: "off", auto_compact: settings.auto_compact });
    assert.equal(h.repo.available(h.thread.id), false);
    assert.throws(() => h.repo.consult(h.thread.id, h.agent.id, "", h.source.id), /not allowed/);
    assert.throws(
      () => h.repo.propose(h.thread.id, h.agent.id, h.run().id, h.source.id, h.source.revision, "Tuesday", "Wednesday"),
      /not allowed/,
    );
  } finally {
    await h.close();
  }
});
