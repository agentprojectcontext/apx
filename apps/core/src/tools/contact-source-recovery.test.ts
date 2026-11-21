import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { saveSources, sourceHash, sourceState } from "../domain/contact-source-state.ts";
import { sourceFixture } from "./contact-sources.test-support.ts";

for (const change of ["revoked", "unavailable", "changed"] as const) {
  test(`an interrupted correction can close with an explicit unresolved outcome after its source is ${change}`, async () => {
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
      const journal = sourceState(h.env.core.store);
      const saved = journal.updates.find((u) => u.id === update.id);
      assert.ok(saved);
      saved.state = "applying";
      saved.result_revision = sourceHash("interrupted replacement");
      saveSources(h.env.core.store, journal);
      if (change === "revoked") await h.env.client.call("contacts.sources.remove", { id: h.source.id });
      if (change === "unavailable") fs.unlinkSync(h.file);
      if (change === "changed") fs.writeFileSync(h.file, "Concurrent owner edit");
      const before = fs.existsSync(h.file) ? fs.readFileSync(h.file, "utf8") : undefined;
      const result = await h.env.client.call("contacts.source_updates.resolve", { id: update.id, accept: false });
      assert.equal(result.state, "unresolved");
      assert.equal(
        (await h.env.client.call("contacts.source_updates.resolve", { id: update.id, accept: true })).state,
        "unresolved",
      );
      assert.equal(fs.existsSync(h.file) ? fs.readFileSync(h.file, "utf8") : undefined, before);
    } finally {
      await h.close();
    }
  });
}

for (const written of [false, true]) {
  test(`rejecting an interrupted approved correction requires proof that no write occurred: ${written}`, async () => {
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
      const before = fs.readFileSync(h.file, "utf8");
      const after = before.replace("Tuesday", "Wednesday");
      const journal = sourceState(h.env.core.store);
      const saved = journal.updates.find((u) => u.id === update.id);
      assert.ok(saved);
      saved.state = "applying";
      saved.result_revision = sourceHash(after);
      saveSources(h.env.core.store, journal);
      if (written) fs.writeFileSync(h.file, after);
      if (written) {
        await assert.rejects(
          h.env.client.call("contacts.source_updates.resolve", { id: update.id, accept: false }),
          /already completed/,
        );
        assert.equal(h.repo.updates()[0]?.state, "applying");
        await h.env.client.call("contacts.source_updates.resolve", { id: update.id, accept: true });
        assert.equal(h.repo.updates()[0]?.state, "accepted");
      } else {
        const result = await h.env.client.call("contacts.source_updates.resolve", { id: update.id, accept: false });
        assert.equal(result.state, "rejected");
      }
      assert.equal(fs.readFileSync(h.file, "utf8"), written ? after : before);
    } finally {
      await h.close();
    }
  });
}
