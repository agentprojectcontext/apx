import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createDiscovery } from "./discovery.ts";
import { say, scriptedLlm } from "./testkit.ts";

for (const phase of ["plan", "read"] as const)
  test(`project authorization is rechecked after asynchronous ${phase} work`, async () => {
    const dir = tempDir("apx-discovery-revoke-");
    const db = openDb(dir.path);
    const store = createStore(db, createBus());
    seed(store, "Nova");
    const at = "2026-05-01T12:00:00.000Z";
    for (const id of ["alpha", "beta"])
      store.projects.upsert({ id, name: id, context: `${id.toUpperCase()}_ONLY workflow decisions.` });
    let revoked = "";
    const sources = ["alpha", "beta"].map((project) => ({
      project,
      label: project,
      pages: [`https://example.com/${project}`],
      public_terms: "",
    }));
    const llm = scriptedLlm((request) => {
      if (String(request.messages[0]?.content).startsWith("Discover one worthwhile")) {
        const current = JSON.parse(String(request.messages[1]?.content)).project;
        assert.match(current, /^(alpha|beta)$/);
        if (!revoked) {
          revoked = current === "alpha" ? "beta" : "alpha";
          store.projects.unregister(revoked);
        }
        return say(
          JSON.stringify({
            question: "Does the official release fit the workflow?",
            rationale: "Check before deciding.",
          }),
        );
      }
      return say(JSON.stringify({ findings: [] }));
    });
    const discovery = createDiscovery({
      store,
      llm,
      models: () => ["fake/model"],
      now: () => new Date(at),
      web: {
        async search() {
          return [];
        },
        async read(url) {
          if (phase === "read") {
            const source = sources.find((item) => item.pages.includes(url));
            assert.ok(source);
            store.projects.unregister(source.project);
          }
          return { url, title: "Public page", text: "A public release announcement.", read_at: at };
        },
      },
    });
    try {
      discovery.configure({ enabled: true, sources, project_context: phase === "plan", project_websites: false });
      await discovery.check.run(new Date(at));
      if (phase === "plan") {
        assert.equal(llm.calls.length, 2, "only the remaining project is planned and researched");
        assert.ok(revoked);
        for (const call of llm.calls)
          assert.ok(!JSON.stringify(call.messages).includes(`${revoked.toUpperCase()}_ONLY`));
      } else assert.equal(llm.calls.length, 0, "revocation during the read prevents the subsequent model request");
      assert.deepEqual(discovery.status().findings, []);
    } finally {
      await discovery.close();
      db.close();
      await dir.remove();
    }
  });
