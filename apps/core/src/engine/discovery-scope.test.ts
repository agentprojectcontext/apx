import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { discoveryState } from "../domain/discovery-state.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createDiscovery } from "./discovery.ts";
import { say, scriptedLlm } from "./testkit.ts";

const AT = "2026-05-01T12:00:00.000Z";

test("all registered projects are scanned, private questions progress fairly and scopes never mix or become search terms", async () => {
  const dir = tempDir("apx-discovery-scope-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const global = store.threads.create({ kind: "loose", title: "Global notes", agent_ids: ["superagent"] });
  store.tasks.create({ title: "GLOBAL_TASK_ONLY", status: "backlog", by: "owner", thread_id: global.id });
  store.projects.upsert({
    id: "alpha",
    name: "Acme",
    context: "ALPHA_ONLY: planned export launch. Official site https://example.com/pricing",
  });
  store.projects.upsert({
    id: "beta",
    name: "Northwind",
    context: "BETA_ONLY: scheduling decisions. Official site https://example.org/docs",
  });
  store.projects.upsert({
    id: "excluded",
    name: "Globex",
    context: "EXCLUDED_ONLY https://excluded.example/",
    registered: false,
  });
  store.projects.unregister("excluded");
  const reads: string[] = [];
  const llm = scriptedLlm((request) =>
    say(
      JSON.stringify(
        String(request.messages[0]?.content).startsWith("Discover one worthwhile")
          ? {
              question: "Does the official plan support the proposed workflow?",
              rationale: "Check capabilities before deciding.",
            }
          : { findings: [] },
      ),
    ),
  );
  const discovery = createDiscovery({
    store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    web: {
      async search() {
        assert.fail("Private questions must never become public searches");
      },
      async read(url) {
        reads.push(url);
        return { url, title: "Public page", text: "Public product documentation.", read_at: AT };
      },
    },
  });
  try {
    discovery.configure({ enabled: true, max_model_calls: 3 });
    await discovery.check.run(new Date(AT));
    assert.equal(
      llm.calls.length,
      2,
      "leave a call available to verify rather than proposing an unverifiable next source",
    );
    assert.deepEqual(
      discovery
        .status()
        .coverage.map((p) => p.project)
        .sort(),
      ["alpha", "beta"],
    );
    assert.ok(discovery.status().coverage.every((p) => p.reviewed_at === AT));
    assert.equal(discovery.status().coverage.filter((p) => p.planned_at).length, 1);
    assert.deepEqual(reads, ["https://example.com/"]);
    for (const request of llm.calls) {
      const text = JSON.stringify(request.messages);
      assert.doesNotMatch(text, /EXCLUDED_ONLY|GLOBAL_TASK_ONLY/);
      assert.ok(!(text.includes("ALPHA_ONLY") && text.includes("BETA_ONLY")));
      assert.deepEqual(request.tools, []);
    }
    await discovery.check.run(new Date("2026-05-02T12:00:00.000Z"));
    assert.equal(
      llm.calls.length,
      3,
      "only the remaining project's private question is planned on the intermediate day",
    );
    assert.equal(discovery.status().coverage.filter((p) => p.planned_at).length, 2);
    assert.equal(reads.length, 1, "intermediate day does not fetch the web again");
    for (const id of ["alpha", "beta"]) {
      const project = store.projects.get(id);
      assert.ok(project);
      store.projects.upsert({
        ...project,
        context: `${project.context}\n${id.toUpperCase()}_ONLY: deployment requirements changed.`,
      });
    }
    await discovery.check.run(new Date("2026-05-03T12:00:00.000Z"));
    await discovery.check.run(new Date("2026-05-04T12:00:00.000Z"));
    assert.ok(
      discovery.status().coverage.every((p) => (p.planned_at ?? "") >= "2026-05-03"),
      "changed projects stay queued until their own question is refreshed, even when the budget fits only one per day",
    );
    discovery.configure({ projects: "selected", project_ids: ["beta"], project_context: false });
    await discovery.check.run(new Date("2026-05-05T12:00:00.000Z"));
    assert.deepEqual(
      discovery.status().coverage.map((p) => p.project),
      ["beta"],
    );
    assert.doesNotMatch(JSON.stringify(llm.calls.at(-1)?.messages), /ALPHA_ONLY|BETA_ONLY/);
    const runtime = discoveryState(store, () => new Date(AT));
    runtime.write({ ...runtime.read(), state: "working" });
    const recovered = createDiscovery({ store, llm, models: () => ["fake/model"], now: () => new Date(AT) });
    assert.equal(recovered.status().state, "uncertain");
    await recovered.close();
  } finally {
    await discovery.close();
    db.close();
    await dir.remove();
  }
});

test("a project's private question is planned against the public sources the owner authorized for it", async () => {
  const dir = tempDir("apx-discovery-plan-sources-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  store.projects.upsert({ id: "alpha", name: "Acme", context: "ALPHA_ONLY: export integration pending." });
  store.projects.upsert({ id: "beta", name: "Northwind", context: "BETA_ONLY: scheduling decisions." });
  const plans: string[] = [];
  const llm = scriptedLlm((request) => {
    const planning = String(request.messages[0]?.content).startsWith("Discover one worthwhile");
    if (planning) plans.push(String(request.messages[1]?.content));
    return say(JSON.stringify(planning ? { question: "", rationale: "" } : { findings: [] }));
  });
  const discovery = createDiscovery({
    store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    web: {
      async search() {
        return [];
      },
      async read(url) {
        return { url, title: "Public page", text: "Public product documentation.", read_at: AT };
      },
    },
  });
  try {
    discovery.configure({
      enabled: true,
      projects: "selected",
      project_ids: ["alpha", "beta"],
      project_websites: false,
      sources: [
        { project: "alpha", label: "Acme API", public_terms: "", pages: ["https://acme.example/docs/auth"] },
        { project: "beta", label: "Northwind blog", public_terms: "", pages: ["https://northwind.example/blog"] },
      ],
    });
    await discovery.check.run(new Date(AT));
    const alpha = plans.find((p) => p.includes("ALPHA_ONLY"));
    assert.ok(alpha, "the project's question was planned");
    assert.deepEqual(JSON.parse(alpha).public_sources, [
      { label: "Acme API", pages: ["https://acme.example/docs/auth"] },
    ]);
    assert.doesNotMatch(alpha, /Northwind blog|northwind\.example/, "another project's sources never reach it");
  } finally {
    await discovery.close();
    db.close();
    await dir.remove();
  }
});
