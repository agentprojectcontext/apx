import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATIONS } from "../../../core/src/db/migrations.ts";
import { scriptedLlm, startCore } from "../../../core/src/engine/testkit.ts";
import { tempDir } from "../../../core/src/testkit/platform.ts";

for (const alias of ["--fix", "fix"]) {
  test(`doctor ${alias} repairs a recognized offline fixture and the real core opens its data`, async () => {
    await using home = tempDir();
    const db = new DatabaseSync(path.join(home.path, "apx.db"));
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const sql of MIGRATIONS.slice(0, 108)) db.exec(sql);
    db.exec(
      "ALTER TABLE jobs ADD COLUMN start_error TEXT; INSERT INTO meta VALUES ('schema_version','109'); INSERT INTO meta VALUES ('setting:kept','Owner data')",
    );
    db.close();
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "../main.ts"), "doctor", alias, "--json"], {
      env: {
        ...process.env,
        APX_HOME: home.path,
        APX_URL: undefined,
        APX_PORT: "0",
        APX_RELEASES: "off",
        APX_TELEMETRY: "off",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const repair = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "null") as {
      repaired: boolean;
      version: number;
      backup: string;
    };
    assert.equal(repair.repaired, true);
    assert.equal(repair.version, 115);
    assert.ok(repair.backup);
    const env = await startCore({
      home: home.path,
      llm: scriptedLlm(() => ({ message: { role: "assistant", content: "Ready" } })),
    });
    try {
      const health = await env.client.call("system.health", {});
      assert.equal(health.code_sha, env.core.identity.code_sha);
      assert.ok(health.code_sha.length > 0);
      assert.equal(env.core.store.settings.get("kept"), "Owner data");
      assert.equal(health.name, "apx-core");
    } finally {
      await env.core.close();
    }
  });
}

test("doctor rejects an unrecognized positional argument instead of silently diagnosing", () => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "../main.ts"), "doctor", "erase"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage: apx doctor/);
});
