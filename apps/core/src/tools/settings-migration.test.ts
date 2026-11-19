import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsCore } from "./settings.test-support.ts";

const id = "2bd15883-b63d-4e7c-9fd0-d80fb5736f0e";
test("migration stays reachable through settings and apply/recover retain the card even in Total", async () => {
  const h = await settingsCore();
  try {
    const methods = (await h.ask({ method: "agents" })).answer;
    assert.match(methods, /agents\.migration_preview/);
    assert.match(methods, /agents\.migrate/);
    assert.match(methods, /agents\.migration_recover/);
    await h.inMode("total", async () => {
      const move = await h.ask(
        {
          method: "agents.migrate",
          params: { agent: "acme", destination: "p_northwind", paths: ["reports"], id, revision: "reviewed" },
        },
        "deny",
      );
      assert.match(move.detail, /^Move .* and its work to/);
      assert.match(move.detail, /reports/);
      assert.match(move.detail, /reviewed/);
      assert.match(move.answer, /not run|declin|denied|cancel/i);
      const recovery = await h.ask({ method: "agents.migration_recover", params: { id } }, "deny");
      assert.match(recovery.detail, /^Restore the agent and its work/);
      assert.match(recovery.detail, new RegExp(id));
    });
  } finally {
    await h.env.core.close();
    await h.env.cleanup();
  }
});
