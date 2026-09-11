// The vault list says what a template WOULD tell the agent.
//
// Importing one was a bet on its slug: "gc — General Counsel" says nothing
// about what that agent is instructed to do, which model it is pinned to, or
// whether it can reach the shell, and the only way to find out was to import it
// and go read the file it left behind in .apc/agents. The import dialog now
// opens a card on hover, and this is the field it reads.
//
// Capped on purpose: the twenty bundled templates come to ~100 KB of prompt
// between them, and this list is fetched on open by two screens. The list ships
// a HEAD of each prompt plus the real size — never the whole file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vault-preview-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
// APX_HOME and not HOME alone: the runner sets its own, and it wins.
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { writeVaultAgentFile } = await import("#core/apc/scaffold.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp() {
  return buildApi({
    projects: new ProjectManager({}),
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
}

async function vaultList() {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/api/agents/vault`);
    assert.equal(res.status, 200);
    return await res.json();
  } finally {
    server.close();
  }
}

test("a short prompt comes back whole, with its size and no more-marker", async () => {
  const body = "You are the test agent.\nYou answer in one line.";
  writeVaultAgentFile("peek-short", { Role: "Tester", Tools: ["run_shell"] }, body);

  const row = (await vaultList()).find((a) => a.slug === "peek-short");
  assert.ok(row, "the template must be listed");
  assert.equal(row.system_preview, body);
  assert.equal(row.system_more, false, "nothing was cut");
  assert.equal(row.system_bytes, Buffer.byteLength(body, "utf8"));
  // The card draws these next to the prompt, so they have to survive the trip.
  assert.equal(row.role, "Tester");
  assert.deepEqual(row.tools, ["run_shell"]);
});

test("a long prompt is cut, and the row says so instead of shipping the file", async () => {
  // Lines, so the cut has a break to land on — a preview that ends mid-word
  // reads as corruption rather than as a preview.
  const body = Array.from({ length: 400 }, (_, i) => `Rule ${i}: never do the thing.`).join("\n");
  // With real frontmatter: a template written with NO fields at all comes back
  // from the parser with an empty body (its `---\n---\n` header swallows it),
  // which is a separate bug and not what this file is about.
  writeVaultAgentFile("peek-long", { Role: "Rulemonger" }, body);

  const row = (await vaultList()).find((a) => a.slug === "peek-long");
  assert.ok(row);
  assert.ok(row.system_preview.length < body.length, "the whole prompt must not ride in the list");
  assert.ok(row.system_preview.length <= 900, "capped");
  assert.ok(row.system_preview.length > 400, "but long enough to read");
  assert.equal(row.system_more, true, "the card shows an ellipsis off this");
  assert.equal(row.system_bytes, Buffer.byteLength(body, "utf8"), "the SIZE is the real one");
  assert.ok(body.startsWith(row.system_preview), "a head of the prompt, not a summary of it");
  assert.ok(!row.system_preview.endsWith("never"), "cut on a line, not mid-word");
});

test("every bundled template carries a readable preview", async () => {
  const rows = (await vaultList()).filter((a) => a.source === "bundled");
  assert.ok(rows.length >= 5, "the bundle ships templates");
  for (const row of rows) {
    assert.equal(typeof row.system_preview, "string", `${row.slug} has a preview field`);
    assert.ok(row.system_bytes > 0, `${row.slug} has a prompt at all`);
  }
});
