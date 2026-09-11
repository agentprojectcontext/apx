// WHERE a project's config file lives, and what happens to one written before
// it moved.
//
// It used to be `<repo>/.apc/config.json` — a COMMITTED path. `apx config set`
// without `--global` wrote it, and so did the web panel's Engines tab, which
// meant a provider api_key typed in the wrong place was staged for the next
// push. The warning that guarded this was a warning, not a wall.
//
// The file is now `~/.apx/projects/<apx_id>/config.json`: machine-local by
// construction, so no scope mistake can leak a key into someone's repo. These
// tests pin that, plus the one-time move of a legacy file — which MOVES rather
// than copies, because a copy left behind is the leak it is closing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-pcfg-"));
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  readProjectConfig,
  writeProjectConfig,
  projectConfigPath,
  legacyProjectConfigPath,
  effectiveConfig,
} = await import("#host/daemon/project-config.js");
const { projectStorageRoot } = await import("#core/config/paths.js");

let seq = 0;
function makeProject({ apxId = null, legacy = null } = {}) {
  const root = fs.mkdtempSync(path.join(TMP_HOME, `proj-${seq++}-`));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });
  const meta = { name: path.basename(root), apx: "installed" };
  if (apxId) meta.apx_id = apxId;
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify(meta, null, 2));
  if (legacy) {
    fs.writeFileSync(path.join(root, ".apc", "config.json"), JSON.stringify(legacy, null, 2));
  }
  return root;
}

// --- where -----------------------------------------------------------------

test("the config path is the project's storage, not its repo", () => {
  const root = makeProject({ apxId: "aaaa11112222" });
  const p = projectConfigPath(root);
  assert.equal(p, path.join(projectStorageRoot("aaaa11112222"), "config.json"));
  assert.ok(!p.startsWith(root), "nothing under the checkout");
  assert.ok(!p.includes(`${path.sep}.apc${path.sep}`), "nothing under .apc/");
});

test("a write lands in storage and leaves the repo untouched", () => {
  const root = makeProject({ apxId: "bbbb11112222" });
  writeProjectConfig(root, { engines: { zen: { api_key: "zen-live-123" } } });

  assert.equal(readProjectConfig(root).engines.zen.api_key, "zen-live-123");
  assert.ok(fs.existsSync(projectConfigPath(root)));
  assert.ok(!fs.existsSync(legacyProjectConfigPath(root)), "no config.json in .apc/");
  assert.deepEqual(fs.readdirSync(path.join(root, ".apc")), ["project.json"]);
});

test("two projects keep separate configs", () => {
  const a = makeProject({ apxId: "cccc11112222" });
  const b = makeProject({ apxId: "dddd11112222" });
  writeProjectConfig(a, { super_agent: { model: "a:one" } });
  writeProjectConfig(b, { super_agent: { model: "b:two" } });
  assert.equal(readProjectConfig(a).super_agent.model, "a:one");
  assert.equal(readProjectConfig(b).super_agent.model, "b:two");
});

test("a directory with no apx_id falls back rather than inventing storage", () => {
  // A bare folder has no storage to point at. Guessing one would scatter
  // orphan config files under ~/.apx/projects/undefined.
  const root = makeProject({});
  assert.equal(projectConfigPath(root), legacyProjectConfigPath(root));
});

// --- migration -------------------------------------------------------------

test("a legacy .apc/config.json is moved on first read, not copied", () => {
  const root = makeProject({
    apxId: "eeee11112222",
    legacy: { engines: { openai: { api_key: "sk-was-in-git" } } },
  });

  const cfg = readProjectConfig(root);
  assert.equal(cfg.engines.openai.api_key, "sk-was-in-git", "settings survive the move");
  assert.ok(fs.existsSync(projectConfigPath(root)), "new file written");
  assert.ok(!fs.existsSync(legacyProjectConfigPath(root)), "old file gone — a copy would still be in git");
});

test("the moved config is what an agent run sees", () => {
  const root = makeProject({
    apxId: "ffff11112222",
    legacy: { super_agent: { model: "project:pinned" } },
  });
  const eff = effectiveConfig({ super_agent: { model: "global:default", enabled: true } }, root);
  assert.equal(eff.super_agent.model, "project:pinned", "project wins");
  assert.equal(eff.super_agent.enabled, true, "and the rest of global is still there");
});

test("an unreadable legacy file does not take the project down with it", () => {
  const root = makeProject({ apxId: "1111aaaabbbb" });
  fs.writeFileSync(legacyProjectConfigPath(root), "{ this is not json");
  assert.deepEqual(readProjectConfig(root), {});
});

test("a config already in storage wins over a stale legacy file", () => {
  const root = makeProject({ apxId: "2222aaaabbbb", legacy: { super_agent: { model: "stale:old" } } });
  writeProjectConfig(root, { super_agent: { model: "current:new" } });
  // The write also cleared the legacy file, so there is nothing left to
  // re-adopt on the next read — which is what would silently undo the save.
  assert.ok(!fs.existsSync(legacyProjectConfigPath(root)));
  assert.equal(readProjectConfig(root).super_agent.model, "current:new");
});

// --- the other half: what may NOT go in the repo ----------------------------
//
// `.apc/project.json` stays committed — it is what someone else reads in a diff
// — so the write routes refuse anything credential-shaped rather than trusting
// the UI to have filtered. Without this, moving the config out of the repo just
// moves where the accident happens.

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function apiFor(root) {
  const projects = new ProjectManager({});
  const entry = projects.register(root);
  const app = buildApi({
    projects, registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: {}, token: "",
  });
  return { app, pid: entry.id };
}

const JSON_HEADERS = { "content-type": "application/json" };

test("the committed project.json refuses a credential, however it is shaped", async () => {
  const root = makeProject({ apxId: "3333aaaabbbb" });
  const { app, pid } = apiFor(root);
  const { server, baseUrl } = await listen(app);
  try {
    const cases = [
      // the key IS the credential
      { set: { "engines.evil.api_key": "sk-leak" } },
      // the credential rides inside the VALUE, where a leaf check never sees it
      { set: { vendor: { api_key: "sk-nested" } } },
    ];
    for (const body of cases) {
      const r = await fetch(`${baseUrl}/api/projects/${pid}/apc-project`, {
        method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match((await r.json()).error, /committed/);
    }
    // A whole-file PUT is the same door.
    const put = await fetch(`${baseUrl}/api/projects/${pid}/apc-project`, {
      method: "PUT", headers: JSON_HEADERS,
      body: JSON.stringify({ name: "acme", telegram: { bot_token: "123:abc" } }),
    });
    assert.equal(put.status, 400);

    const onDisk = JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"));
    assert.equal(onDisk.engines, undefined);
    assert.equal(onDisk.vendor, undefined);
    assert.equal(onDisk.telegram, undefined);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test("ordinary metadata still writes — the guard is narrow, not a wall", async () => {
  const root = makeProject({ apxId: "4444aaaabbbb" });
  const { app, pid } = apiFor(root);
  const { server, baseUrl } = await listen(app);
  try {
    const r = await fetch(`${baseUrl}/api/projects/${pid}/apc-project`, {
      method: "PATCH", headers: JSON_HEADERS,
      body: JSON.stringify({ set: { kind: "company", version: "2.0.0" } }),
    });
    assert.equal(r.status, 200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"));
    assert.equal(onDisk.kind, "company");
    assert.equal(onDisk.version, "2.0.0");
  } finally {
    await new Promise((res) => server.close(res));
  }
});
