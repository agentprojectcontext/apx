import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { discoveryState } from "../domain/discovery-state.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { WORK } from "./settings-work.ts";

test("derived research settings refuse unknown and project-agent readers", async () => {
  const dir = tempDir("apx-discovery-settings-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  try {
    const read = WORK["discovery.settings"]?.read;
    const secretary = store.agents.get("superagent");
    assert.ok(read && secretary);
    store.projects.upsert({ id: "acme", name: "Acme" });
    const state = discoveryState(store, () => new Date("2030-05-01T12:00:00.000Z"));
    state.write({
      ...state.read(),
      findings: [
        {
          id: "finding",
          topic: "topic",
          project: "acme",
          title: "PRIVATE_ACME_FINDING",
          summary: "A private connection with the planned export workflow.",
          action: "Evaluate the format.",
          uncertainty: "Not tested.",
          evidence: [
            {
              url: "https://example.com/news",
              title: "Acme news",
              quote: "Acme announced a new format.",
              read_at: "2030-05-01T12:00:00.000Z",
            },
          ],
          found_at: "2030-05-01T12:00:00.000Z",
          expires_at: "2030-05-07T12:00:00.000Z",
        },
      ],
    });
    const deps = { store, profiles: [], templates: [] };
    assert.match(read({}, deps, { agent: secretary }), /PRIVATE_ACME_FINDING/);
    assert.doesNotMatch(read({}, deps), /PRIVATE_ACME_FINDING/);
    assert.doesNotMatch(
      read({}, deps, { agent: { ...secretary, id: "other-agent", kind: "agent", project_id: "northwind" } }),
      /PRIVATE_ACME_FINDING/,
    );
  } finally {
    db.close();
    await dir.remove();
  }
});
