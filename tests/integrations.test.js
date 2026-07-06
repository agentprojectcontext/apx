import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { IntegrationStore, resolveIntegration, redactRecord } from "../src/core/integrations/store.js";
import { asanaPlugin } from "../src/core/integrations/plugins/asana.js";
import { githubPlugin } from "../src/core/integrations/plugins/github.js";
import { listCatalog, getPluginService } from "../src/core/integrations/catalog.js";

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-integrations-"));
  return { dir, store: new IntegrationStore(dir) };
}

test("IntegrationStore: upsert creates, get/list read, remove deletes", () => {
  const { store } = tmpStore();
  assert.equal(store.list().length, 0);

  const created = store.upsert("asana", {
    name: "Asana",
    type: "project_management",
    status: "pending_validation",
    config: { personal_access_token: "1/secret:abc" },
  });
  assert.equal(created.slug, "asana");
  assert.equal(store.list().length, 1);
  assert.equal(store.get("asana").config.personal_access_token, "1/secret:abc");

  // Patch merges config without clobbering the token.
  const patched = store.upsert("asana", { status: "active", is_enabled: true, config: { workspace_gid: "42" } });
  assert.equal(patched.status, "active");
  assert.equal(patched.config.personal_access_token, "1/secret:abc");
  assert.equal(patched.config.workspace_gid, "42");

  assert.equal(store.remove("asana"), true);
  assert.equal(store.remove("asana"), false);
  assert.equal(store.list().length, 0);
});

test("IntegrationStore: file is written chmod 0600 (tokens live here)", () => {
  const { dir, store } = tmpStore();
  store.upsert("asana", { config: { personal_access_token: "1/x:y" } });
  const mode = fs.statSync(path.join(dir, "integrations.json")).mode & 0o777;
  // Skip the assertion on filesystems that don't support POSIX perms.
  if (process.platform !== "win32") assert.equal(mode, 0o600);
});

test("redactRecord: hides secrets, exposes *_set flags", () => {
  const red = redactRecord({
    slug: "asana",
    config: { personal_access_token: "1/secret", workspace_gid: "42", user_name: "Manu" },
  });
  assert.equal(red.config.personal_access_token, undefined);
  assert.equal(red.config.personal_access_token_set, true);
  assert.equal(red.config.workspace_gid, "42");
  assert.equal(red.config.user_name, "Manu");
});

test("resolveIntegration: project record wins over default; falls back otherwise", () => {
  const project = tmpStore();
  const def = tmpStore();

  // Only the default has an active Asana → project falls back to it.
  def.store.upsert("asana", { status: "active", is_enabled: true, config: { workspace_gid: "global" } });
  let r = resolveIntegration({ projectStorage: project.dir, defaultStorage: def.dir, slug: "asana" });
  assert.equal(r.scope, "global");
  assert.equal(r.record.config.workspace_gid, "global");

  // Project gets its own active Asana → it wins.
  project.store.upsert("asana", { status: "active", is_enabled: true, config: { workspace_gid: "proj" } });
  r = resolveIntegration({ projectStorage: project.dir, defaultStorage: def.dir, slug: "asana" });
  assert.equal(r.scope, "project");
  assert.equal(r.record.config.workspace_gid, "proj");

  // A disabled project record is ignored, falling back to default.
  project.store.upsert("asana", { status: "inactive", is_enabled: false });
  r = resolveIntegration({ projectStorage: project.dir, defaultStorage: def.dir, slug: "asana" });
  assert.equal(r.scope, "global");
});

test("asanaPlugin.configure: builds a patch that marks pending validation", () => {
  const { patch } = asanaPlugin.configure(null, { personal_access_token: "  1/tok:secret  " });
  assert.equal(patch.config.personal_access_token, "1/tok:secret"); // trimmed
  assert.equal(patch.status, "pending_validation");
  assert.equal(patch.name, "Asana");
});

test("asanaPlugin.configure: rejects an empty body on a brand-new record", () => {
  assert.throws(() => asanaPlugin.configure(null, {}), /personal_access_token or workspace_gid/);
});

test("asanaPlugin.status: reports a disconnected shape for a null record", () => {
  const s = asanaPlugin.status(null);
  assert.equal(s.slug, "asana");
  assert.equal(s.status, "disconnected");
  assert.equal(s.is_enabled, false);
});

test("asanaPlugin.deactivate: disables without dropping config", () => {
  const { patch } = asanaPlugin.deactivate({ config: { personal_access_token: "x" } });
  assert.equal(patch.is_enabled, false);
  assert.equal(patch.status, "inactive");
  assert.equal(patch.config, undefined); // config untouched
});

test("catalog: asana + github implemented (with ui), whatsapp coming soon, no telegram/transcription", () => {
  const catalog = listCatalog();
  const asana = catalog.find((c) => c.slug === "asana");
  assert.equal(asana.coming_soon, false);
  assert.ok(asana.tools.length >= 4);
  assert.ok(asana.ui && asana.ui.configFields.length >= 1, "asana carries a ui descriptor");
  assert.equal(getPluginService("asana"), asanaPlugin);

  const github = catalog.find((c) => c.slug === "github");
  assert.equal(github.coming_soon, false);
  assert.ok(github.ui && github.ui.configFields.some((f) => f.key === "token"));
  assert.ok(getPluginService("github"));

  assert.ok(catalog.find((c) => c.slug === "whatsapp").coming_soon);
  // Telegram is a channel, transcription lives with desktop STT — neither belongs here.
  assert.equal(catalog.find((c) => c.slug === "telegram"), undefined);
  assert.equal(catalog.find((c) => c.slug === "local-transcription"), undefined);
});

test("githubPlugin.configure: stores token + marks pending validation", () => {
  const { patch } = githubPlugin.configure(null, { token: "  ghp_secret  " });
  assert.equal(patch.config.token, "ghp_secret");
  assert.equal(patch.status, "pending_validation");
  assert.equal(patch.name, "GitHub");
});

test("githubPlugin.status: disconnected shape for null record", () => {
  const s = githubPlugin.status(null);
  assert.equal(s.slug, "github");
  assert.equal(s.status, "disconnected");
  assert.equal(s.is_enabled, false);
});
