import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  obsidianPlugin,
  listNotes,
  readNote,
  writeNote,
  searchNotes,
  isObsidianVault,
  resolveVaultPath,
  expandHome,
  ensureProjectVault,
} from "../src/core/integrations/plugins/obsidian.js";
import { collectMemorySources, syncMemoryToVault } from "../src/core/integrations/obsidian-memory.js";
import { reconcilePluginMcp } from "../src/core/integrations/mcp-sync.js";
import { readRuntimeMcps } from "../src/core/mcp/sources.js";
import { listCatalog, getPluginService } from "../src/core/integrations/catalog.js";

// Build a throwaway vault with a couple of notes + a .obsidian marker.
function tmpVault({ obsidian = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-obsidian-"));
  if (obsidian) fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Notes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Welcome.md"), "# Welcome\nHello vault, this mentions gizmo.\n");
  fs.writeFileSync(path.join(dir, "Notes", "Idea.md"), "An idea about widgets.\n");
  fs.writeFileSync(path.join(dir, "ignore.txt"), "not markdown");
  return dir;
}

// ─── vault client ────────────────────────────────────────────────────────────

test("listNotes returns markdown, sorted, skipping dot-dirs and non-md", () => {
  const dir = tmpVault();
  const notes = listNotes(dir);
  assert.deepEqual(notes, ["Notes/Idea.md", "Welcome.md"]);
});

test("readNote reads by path (with or without .md); missing throws", () => {
  const dir = tmpVault();
  assert.match(readNote(dir, "Welcome"), /Hello vault/);
  assert.match(readNote(dir, "Notes/Idea.md"), /widgets/);
  assert.throws(() => readNote(dir, "Nope"), /Note not found/);
});

test("writeNote overwrites and appends, creating folders", () => {
  const dir = tmpVault();
  const w = writeNote(dir, "Inbox/New.md", "first");
  assert.equal(w.note, "Inbox/New.md");
  assert.equal(readNote(dir, "Inbox/New.md"), "first");
  writeNote(dir, "Inbox/New.md", "second", { mode: "append" });
  assert.equal(readNote(dir, "Inbox/New.md"), "first\nsecond");
  writeNote(dir, "Inbox/New.md", "reset");
  assert.equal(readNote(dir, "Inbox/New.md"), "reset");
});

test("note paths cannot escape the vault", () => {
  const dir = tmpVault();
  assert.throws(() => readNote(dir, "../outside.md"), /escapes the vault/);
  assert.throws(() => writeNote(dir, "../../evil.md", "x"), /escapes the vault/);
});

test("searchNotes matches bodies and filenames with snippets", () => {
  const dir = tmpVault();
  const hits = searchNotes(dir, "gizmo");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].note, "Welcome.md");
  assert.match(hits[0].snippet, /gizmo/);
  // filename match (case-insensitive)
  const byName = searchNotes(dir, "idea");
  assert.ok(byName.some((h) => h.note === "Notes/Idea.md"));
});

test("isObsidianVault / expandHome / resolveVaultPath", () => {
  const dir = tmpVault();
  assert.equal(isObsidianVault(dir), true);
  assert.equal(isObsidianVault(tmpVault({ obsidian: false })), false);
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/x"), path.join(os.homedir(), "x"));
  assert.equal(resolveVaultPath(dir), path.resolve(dir));
  assert.throws(() => resolveVaultPath("   "), /empty/);
});

// ─── plugin lifecycle ─────────────────────────────────────────────────────────

test("configure requires a vault path and normalizes toggles", () => {
  assert.throws(() => obsidianPlugin.configure(null, {}), /vault/i);
  const { patch } = obsidianPlugin.configure(null, { vault_path: "/tmp/v", auto_mcp: "true", memory_sync: false });
  assert.equal(patch.status, "pending_validation");
  assert.equal(patch.config.vault_path, "/tmp/v");
  assert.equal(patch.config.auto_mcp, true);
  assert.equal(patch.config.memory_sync, false);
});

test("validate: error on bad path, active with note_count on a real vault", async () => {
  const bad = await obsidianPlugin.validate({ config: { vault_path: "/no/such/vault/xyz" } });
  assert.equal(bad.result.ok, false);
  assert.equal(bad.patch.status, "error");

  const dir = tmpVault();
  const ok = await obsidianPlugin.validate({ config: { vault_path: dir } });
  assert.equal(ok.result.ok, true);
  assert.equal(ok.patch.status, "active");
  assert.equal(ok.patch.is_enabled, true);
  assert.equal(ok.patch.config.note_count, 2);
  assert.equal(ok.patch.config.vault_name, path.basename(dir));
  assert.equal(ok.patch.config.is_vault, true);
});

test("status + deactivate reflect config", () => {
  const record = { status: "active", is_enabled: true, config: { vault_path: "/v", vault_name: "v", note_count: 3, auto_mcp: true, memory_sync: false } };
  const s = obsidianPlugin.status(record);
  assert.equal(s.status, "active");
  assert.equal(s.note_count, 3);
  assert.equal(s.auto_mcp, true);
  const { patch } = obsidianPlugin.deactivate();
  assert.equal(patch.is_enabled, false);
});

test("catalog registers obsidian as an implemented plugin", () => {
  assert.ok(getPluginService("obsidian"));
  const entry = listCatalog().find((e) => e.slug === "obsidian");
  assert.ok(entry);
  assert.equal(entry.coming_soon, false);
  assert.ok(entry.ui.configFields.some((f) => f.key === "vault_path"));
});

// ─── mcpServer hook ────────────────────────────────────────────────────────────

test("mcpServer only yields a def when active AND auto_mcp is on", () => {
  const base = { status: "active", is_enabled: true, config: { vault_path: "/v" } };
  assert.equal(obsidianPlugin.mcpServer({ ...base, config: { ...base.config, auto_mcp: false } }).def, null);
  assert.equal(obsidianPlugin.mcpServer(null).def, null);
  const on = obsidianPlugin.mcpServer({ ...base, config: { ...base.config, auto_mcp: true } });
  assert.equal(on.name, "obsidian");
  assert.deepEqual(on.def, { command: "npx", args: ["-y", "obsidian-mcp", "/v"], enabled: true });
});

// ─── generic MCP reconcile ─────────────────────────────────────────────────────

test("reconcilePluginMcp writes and removes the runtime MCP entry", () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-store-"));
  const project = { id: 7, storagePath };
  const active = { status: "active", is_enabled: true, config: { vault_path: "/v", auto_mcp: true } };

  const added = reconcilePluginMcp({
    desired: obsidianPlugin.mcpServer(active),
    integrationScope: "project",
    project,
    projects: null,
    registries: null,
  });
  assert.equal(added.changed, true);
  assert.equal(added.action, "added");
  assert.deepEqual(readRuntimeMcps(storagePath).mcpServers.obsidian.args, ["-y", "obsidian-mcp", "/v"]);

  // Removing (record gone → def:null) drops it.
  const removed = reconcilePluginMcp({
    desired: obsidianPlugin.mcpServer(null),
    integrationScope: "project",
    project,
    projects: null,
    registries: null,
  });
  assert.equal(removed.action, "removed");
  assert.equal(readRuntimeMcps(storagePath).mcpServers.obsidian, undefined);
});

// ─── memory sync ────────────────────────────────────────────────────────────

test("syncMemoryToVault mirrors sources idempotently (no duplicates)", () => {
  const dir = tmpVault();
  const sources = [
    { id: "global", rel: "APX Global Memory.md", from: "/home/.apx/memory.md", body: "global facts" },
    { id: "p1", rel: "projects/App/memory.md", from: "/repo/.apc/memory.md", body: "project facts" },
  ];
  const first = syncMemoryToVault({ vaultPath: dir, folder: "APX", sources });
  assert.equal(first.count, 2);
  assert.equal(first.changed, 2);
  assert.match(readNote(dir, "APX/APX Global Memory.md"), /global facts/);
  assert.match(readNote(dir, "APX/projects/App/memory.md"), /project facts/);

  // Re-running with identical input rewrites nothing.
  const second = syncMemoryToVault({ vaultPath: dir, folder: "APX", sources });
  assert.equal(second.changed, 0);

  // A changed source is detected.
  sources[0].body = "global facts v2";
  const third = syncMemoryToVault({ vaultPath: dir, folder: "APX", sources });
  assert.equal(third.changed, 1);

  // An index MOC connects every note with wikilinks (graph/backlinks), and each
  // note backlinks to it — but the index is NOT counted as a mirrored source.
  const idx = readNote(dir, "APX/APX Memory Index.md");
  assert.match(idx, /# APX Memory Index/);
  assert.match(idx, /\[\[APX Global Memory\]\]/);
  assert.match(idx, /\[\[projects\/App\/memory\|App\]\]/);
  assert.match(readNote(dir, "APX/projects/App/memory.md"), /Part of \[\[APX Memory Index\]\]/);
  assert.match(readNote(dir, "APX/projects/App/memory.md"), /#apx\/memory/);
});

test("ensureProjectVault: makes a folder a vault + gitignores .obsidian, idempotently", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vaultify-"));
  assert.equal(isObsidianVault(dir), false);

  const first = ensureProjectVault(dir);
  assert.equal(first.created, true);
  assert.equal(first.gitignored, true);
  assert.equal(isObsidianVault(dir), true, ".obsidian created → recognized as a vault");
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\.obsidian\/$/m);

  // Idempotent — a second call creates nothing and doesn't duplicate the ignore.
  const second = ensureProjectVault(dir);
  assert.equal(second.created, false);
  assert.equal(second.gitignored, false);
  const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.equal(gi.match(/\.obsidian\//g).length, 1, "no duplicate .gitignore entry");
});

test("collectMemorySources reads each project's .apc/memory.md", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "apx-repo-"));
  fs.mkdirSync(path.join(repo, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".apc", "memory.md"), "repo memory");
  const projects = { list: () => [{ id: 3, path: repo, config: { name: "MyProj" } }] };
  const sources = collectMemorySources({ projects });
  const proj = sources.find((s) => s.id === "project:3");
  assert.ok(proj);
  assert.equal(proj.rel, "projects/MyProj/memory.md");
  assert.equal(proj.body, "repo memory");
});
