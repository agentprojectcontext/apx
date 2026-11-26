import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createDiscovery } from "./discovery.ts";
import { say, scriptedLlm } from "./testkit.ts";

const AT = "2026-05-01T12:00:00.000Z";
function fixture() {
  const dir = tempDir("apx-discovery-budget-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  for (const id of ["alpha", "beta"])
    store.projects.upsert({ id, name: id, context: `${id.toUpperCase()}_ONLY planned exports.` });
  return {
    store,
    async close() {
      db.close();
      await dir.remove();
    },
  };
}
const sources = [
  { project: "alpha", label: "Acme", pages: ["https://example.com/ALPHA_ONLY"], public_terms: "" },
  { project: "beta", label: "Northwind", pages: ["https://example.org/BETA_ONLY"], public_terms: "" },
];

test("failed source URLs stay out of other projects' model input while the owner can still inspect them", async () => {
  const f = fixture();
  const llm = scriptedLlm(() => say(JSON.stringify({ findings: [] })));
  const discovery = createDiscovery({
    store: f.store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    web: {
      async search() {
        return [];
      },
      async read(url) {
        if (url.includes("ALPHA_ONLY")) throw new Error("Unavailable");
        return { url, title: "Public page", text: "A public announcement.", read_at: AT };
      },
    },
  });
  try {
    discovery.configure({ enabled: true, project_context: false, project_websites: false, sources });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(llm.calls[0]?.messages), /ALPHA_ONLY/);
    assert.match(JSON.stringify(llm.calls[0]?.messages), /BETA_ONLY/);
    assert.equal(discovery.status().inaccessible[0]?.url, sources[0]?.pages[0]);
  } finally {
    await discovery.close();
    await f.close();
  }
});

test("the smallest valid budget reserves proposal and verification despite continuously changing projects", async () => {
  const f = fixture();
  let day = 1;
  const quote = "Acme announced a new public export format.";
  const llm = scriptedLlm((request) => {
    const system = String(request.messages[0]?.content);
    if (system.startsWith("Discover one worthwhile"))
      return say(
        JSON.stringify({
          question: "Does the official format fit this workflow?",
          rationale: "Evaluate before deciding.",
        }),
      );
    if (system.startsWith("Independently check"))
      return say(JSON.stringify({ supported: true, relevant: true, new_topic: true, limitation: "" }));
    return say(
      JSON.stringify({
        findings: [
          {
            topic: `Export edition ${day}`,
            title: `An export edition ${day}`,
            summary: quote,
            action: "Compare the format with the requirements.",
            uncertainty: "Compatibility remains untested.",
            expires_at: "2026-05-07T12:00:00.000Z",
            relevance: 5,
            impact: 5,
            novelty: 5,
            actionable: 5,
            timely: 5,
            local: 0,
            evidence: [{ page: 0, quote }],
          },
        ],
      }),
    );
  });
  const discovery = createDiscovery({
    store: f.store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    web: {
      async search() {
        return [];
      },
      async read(url) {
        return { url, title: "Public announcement", text: `${quote} Edition ${day}.`, read_at: AT };
      },
    },
  });
  try {
    for (const max_model_calls of [1, 2]) assert.throws(() => discovery.configure({ max_model_calls }));
    discovery.configure({
      enabled: true,
      project_context: true,
      project_websites: false,
      sources,
      max_model_calls: 3,
    });
    // Deep research runs every other day.
    for (day = 1; day <= 5; day += 2) {
      for (const project of f.store.projects.list())
        f.store.projects.upsert({ ...project, context: `${project.id} requirements changed on day ${day}.` });
      const before = llm.calls.length;
      await discovery.check.run(new Date(`2026-05-0${day}T12:00:00.000Z`));
      assert.equal(llm.calls.length - before, 3);
      assert.equal(
        llm.calls.filter((call) => String(call.messages[0]?.content).startsWith("Independently check")).length,
        (day + 1) / 2,
      );
      assert.equal(discovery.status().findings.length, (day + 1) / 2);
    }
    assert.ok(discovery.status().coverage.every((project) => project.planned_at && project.researched_at));
  } finally {
    await discovery.close();
    await f.close();
  }
});

test("shared failures are shown once to the owner without removing per-source model context", async () => {
  const f = fixture();
  let malformed = false;
  const llm = scriptedLlm(() => say(malformed ? "not JSON" : JSON.stringify({ findings: [] })));
  const discovery = createDiscovery({
    store: f.store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    web: {
      async search() {
        throw new Error("Search is unavailable");
      },
      async read(url) {
        return { url, title: "Public page", text: "A public announcement.", read_at: AT };
      },
    },
  });
  try {
    discovery.configure({
      enabled: true,
      project_context: false,
      project_websites: false,
      sources: sources.map((source) => ({ ...source, public_terms: "public exports" })),
    });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 2);
    assert.equal(discovery.status().inaccessible.length, 1);
    for (const request of llm.calls) {
      const input = JSON.parse(String(request.messages[1]?.content));
      assert.equal(input.inaccessible.length, 1);
      assert.equal(input.inaccessible[0].kind, "search_unavailable");
    }
    malformed = true;
    discovery.configure({
      sources: sources.map((source) => ({ ...source, pages: ["https://example.com/shared"], public_terms: "" })),
    });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 4);
    assert.equal(discovery.status().inaccessible.length, 1);
    assert.equal(discovery.status().inaccessible[0]?.kind, "unverified");
  } finally {
    await discovery.close();
    await f.close();
  }
});
