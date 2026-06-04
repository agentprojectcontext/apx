// Tests for the per-project runtime MCP source and the priority order across
// runtime > apc > global. Each test isolates HOME so the global file lives in
// a temp dir and never touches the real ~/.apx.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readRuntimeMcps,
  writeRuntimeMcps,
  readGlobalMcps,
  writeGlobalMcps,
  readApfMcps,
  writeApfMcps,
  runtimeMcpsPath,
  globalMcpsPath,
} from "../src/core/mcp/sources.js";

// Dynamic import is required because sources.js captures HOME at module-load
// time when computing the global path. We isolate by reassigning HOME and
// re-importing the module under a fresh URL.
async function withIsolatedHome(fn) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-home-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  // Stub homedir() since some platforms read from getuid()/passwd, not env.
  const origHomedir = os.homedir;
  os.homedir = () => tmpHome;

  // Re-import a fresh copy of sources.js so the constant captured at import
  // time reflects the isolated HOME.
  const url = new URL("../src/core/mcp/sources.js", import.meta.url).href +
    `?t=${Date.now()}-${Math.random()}`;
  const mod = await import(url);

  try {
    await fn({ tmpHome, mod });
  } finally {
    os.homedir = origHomedir;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  }
}

function mkProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-proj-"));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });
  return root;
}

function mkStorage() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-storage-"));
}

// ---------------------------------------------------------------------------
// helpers: read/write round-trip
// ---------------------------------------------------------------------------

test("readRuntimeMcps: returns empty mcpServers when file missing", () => {
  const storage = mkStorage();
  try {
    const data = readRuntimeMcps(storage);
    assert.deepEqual(data, { mcpServers: {} });
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

test("readRuntimeMcps: returns empty mcpServers when storagePath null/undefined", () => {
  assert.deepEqual(readRuntimeMcps(null), { mcpServers: {} });
  assert.deepEqual(readRuntimeMcps(undefined), { mcpServers: {} });
});

test("writeRuntimeMcps + readRuntimeMcps round-trip", () => {
  const storage = mkStorage();
  try {
    const payload = { mcpServers: { foo: { command: "node", args: ["foo.js"] } } };
    writeRuntimeMcps(storage, payload);
    const back = readRuntimeMcps(storage);
    assert.deepEqual(back, payload);
    // File must be physically present at <storage>/mcps.json
    assert.ok(fs.existsSync(runtimeMcpsPath(storage)));
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

test("writeRuntimeMcps: chmods file to 0600 on POSIX", { skip: process.platform === "win32" }, () => {
  const storage = mkStorage();
  try {
    writeRuntimeMcps(storage, { mcpServers: { secret: { command: "x" } } });
    const mode = fs.statSync(runtimeMcpsPath(storage)).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

test("writeRuntimeMcps: throws when storagePath is missing", () => {
  assert.throws(() => writeRuntimeMcps(null, { mcpServers: {} }), /storagePath required/);
});

test("readRuntimeMcps: corrupted JSON returns empty defaults", () => {
  const storage = mkStorage();
  try {
    fs.writeFileSync(runtimeMcpsPath(storage), "{ not json");
    const data = readRuntimeMcps(storage);
    assert.deepEqual(data, { mcpServers: {} });
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// global scope round-trip (isolated HOME)
// ---------------------------------------------------------------------------

test("writeGlobalMcps + readGlobalMcps round-trip in isolated HOME", async () => {
  await withIsolatedHome(async ({ mod, tmpHome }) => {
    const payload = { mcpServers: { gmcp: { command: "node", args: ["g.js"] } } };
    mod.writeGlobalMcps(payload);
    const back = mod.readGlobalMcps();
    assert.deepEqual(back, payload);
    assert.equal(mod.globalMcpsPath(), path.join(tmpHome, ".apx", "mcps.json"));
  });
});

// ---------------------------------------------------------------------------
// loadAll: priority + conflict reporting
// ---------------------------------------------------------------------------

test("loadAll: runtime entries win over apc entries (same name)", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const root = mkProjectRoot();
    const storage = mkStorage();
    try {
      mod.writeApfMcps(root, { mcpServers: { dup: { command: "apc-cmd" } } });
      mod.writeRuntimeMcps(storage, { mcpServers: { dup: { command: "runtime-cmd" } } });

      const { entries, conflicts } = mod.loadAll(root, { storagePath: storage });
      const dup = entries.find((e) => e.name === "dup");
      assert.ok(dup, "merged set must contain 'dup'");
      assert.equal(dup.source, "runtime", "runtime must win over apc");
      assert.equal(dup.command, "runtime-cmd");

      // Conflict is reported with runtime as winner.
      const c = conflicts.find((x) => x.name === "dup");
      assert.ok(c, "conflict for 'dup' must be reported");
      assert.equal(c.winner, "runtime");
      assert.equal(c.loser, "apc");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });
});

test("loadAll: apc entries win over global entries", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const root = mkProjectRoot();
    try {
      mod.writeApfMcps(root, { mcpServers: { gx: { command: "apc-cmd" } } });
      mod.writeGlobalMcps({ mcpServers: { gx: { command: "global-cmd" } } });

      const { entries, conflicts } = mod.loadAll(root);
      const gx = entries.find((e) => e.name === "gx");
      assert.equal(gx.source, "apc");
      assert.equal(gx.command, "apc-cmd");

      const c = conflicts.find((x) => x.name === "gx");
      assert.ok(c);
      assert.equal(c.winner, "apc");
      assert.equal(c.loser, "global");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("loadAll: full priority chain runtime > apc > global", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const root = mkProjectRoot();
    const storage = mkStorage();
    try {
      mod.writeRuntimeMcps(storage, { mcpServers: { triple: { command: "R" } } });
      mod.writeApfMcps(root, { mcpServers: { triple: { command: "A" } } });
      mod.writeGlobalMcps({ mcpServers: { triple: { command: "G" } } });

      const { entries, conflicts } = mod.loadAll(root, { storagePath: storage });
      const t = entries.find((e) => e.name === "triple");
      assert.equal(t.source, "runtime");
      assert.equal(t.command, "R");

      // Two losers should be reported: apc and global.
      const losers = conflicts
        .filter((x) => x.name === "triple")
        .map((x) => x.loser)
        .sort();
      assert.deepEqual(losers, ["apc", "global"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });
});

test("loadAll: runtime-only entry is exposed even without an apc project", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const storage = mkStorage();
    try {
      mod.writeRuntimeMcps(storage, {
        mcpServers: { onlyRuntime: { command: "node", args: ["x.js"] } },
      });
      const { entries } = mod.loadAll(null, { storagePath: storage });
      const e = entries.find((x) => x.name === "onlyRuntime");
      assert.ok(e);
      assert.equal(e.source, "runtime");
    } finally {
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });
});

test("loadAll: global-only entry is exposed when no other source has it", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const root = mkProjectRoot();
    try {
      mod.writeGlobalMcps({ mcpServers: { onlyGlobal: { command: "g" } } });
      const { entries, conflicts } = mod.loadAll(root);
      const e = entries.find((x) => x.name === "onlyGlobal");
      assert.ok(e);
      assert.equal(e.source, "global");
      assert.equal(conflicts.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("loadAll: distinct names from all three sources coexist", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const root = mkProjectRoot();
    const storage = mkStorage();
    try {
      mod.writeRuntimeMcps(storage, { mcpServers: { r: { command: "r-cmd" } } });
      mod.writeApfMcps(root, { mcpServers: { a: { command: "a-cmd" } } });
      mod.writeGlobalMcps({ mcpServers: { g: { command: "g-cmd" } } });

      const { entries, conflicts } = mod.loadAll(root, { storagePath: storage });
      const byName = Object.fromEntries(entries.map((e) => [e.name, e.source]));
      assert.equal(byName.r, "runtime");
      assert.equal(byName.a, "apc");
      assert.equal(byName.g, "global");
      assert.equal(conflicts.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Backwards compat: loadAll(projectRoot) without opts still works.
// ---------------------------------------------------------------------------

test("loadAll: legacy signature loadAll(projectRoot) still works (no runtime)", async () => {
  await withIsolatedHome(async ({ mod }) => {
    const root = mkProjectRoot();
    try {
      mod.writeApfMcps(root, { mcpServers: { legacy: { command: "x" } } });
      const { entries } = mod.loadAll(root);
      const e = entries.find((x) => x.name === "legacy");
      assert.ok(e);
      assert.equal(e.source, "apc");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runtimeMcpsPath shape
// ---------------------------------------------------------------------------

test("runtimeMcpsPath: returns <storagePath>/mcps.json", () => {
  const p = runtimeMcpsPath("/tmp/storage");
  assert.equal(p, path.join("/tmp/storage", "mcps.json"));
});

test("runtimeMcpsPath: returns null for empty storagePath", () => {
  assert.equal(runtimeMcpsPath(null), null);
  assert.equal(runtimeMcpsPath(""), null);
});
