// Relocating ~/.apx after the config module has already loaded.
//
// Every path under the home used to be frozen at import: whichever module
// reached config/paths.js first decided where ~/.apx was for the rest of the
// process. Test isolation was therefore a RACE — a suite that points APX_HOME
// at a temp dir inside its own body only won if nothing had imported config
// before it, which depends on module-graph order and, under a parallel runner,
// on which files share a process. tests/admin-reload and tests/commitments-api
// both flaked on it: they wrote a fixture config into a sandbox and then read
// the developer's real one.
//
// This file forces the losing order ON PURPOSE — config is imported at module
// scope, before any environment is touched — so a regression cannot hide behind
// a lucky import order.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Deliberately eager, and deliberately first: this is the import that used to
// freeze the answer.
import * as paths from "#core/config/paths.js";
import { readConfig, writeConfig } from "#core/config/index.js";

function sandbox(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `apx-${name}-`));
  const apx = path.join(home, ".apx");
  fs.mkdirSync(apx, { recursive: true });
  return { home, apx };
}

function withHome(apxHome, fn) {
  const prev = process.env.APX_HOME;
  process.env.APX_HOME = apxHome;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.APX_HOME;
    else process.env.APX_HOME = prev;
    paths.syncPaths();
  }
}

test("moving APX_HOME after import moves every derived path with it", () => {
  const { apx } = sandbox("relocate");
  const before = paths.CONFIG_PATH;

  withHome(apx, () => {
    assert.equal(paths.syncPaths(), true, "the move is reported");
    assert.equal(paths.APX_HOME, apx);
    // The whole tree, not just the two paths the flaky suites happened to read.
    assert.equal(paths.CONFIG_PATH, path.join(apx, "config.json"));
    assert.equal(paths.NUDGES_PATH, path.join(apx, "nudges.json"));
    assert.equal(paths.GLOBAL_MESSAGES_DIR, path.join(apx, "messages"));
    assert.equal(paths.PROJECT_STORE_ROOT, path.join(apx, "projects"));
    // Nested ones have to be rebuilt from their new parent, not the old one.
    assert.equal(paths.SKILLS_INDEX_PATH, path.join(apx, "skills", ".index.json"));
    assert.equal(paths.APX_LOG_PATH, path.join(apx, "logs", "apx.log"));
    assert.equal(paths.TTS_TMP_DIR, path.join(apx, "tmp", "tts"));
    assert.equal(paths.WHISPER_VENV_DIR, path.join(apx, "runtime", "whisper-venv"));
    assert.equal(paths.DEFAULT_PROJECT_STORE, path.join(apx, "projects", "default"));
    assert.equal(paths.projectStorageRoot("abc"), path.join(apx, "projects", "abc"));
  });

  assert.equal(paths.CONFIG_PATH, before, "and moves back when the sandbox is left");
});

test("readConfig reads the sandbox, not the real home, whatever loaded first", () => {
  const { apx } = sandbox("readconfig");
  fs.writeFileSync(
    path.join(apx, "config.json"),
    JSON.stringify({ super_agent: { model: "sandbox:model" } }),
  );

  withHome(apx, () => {
    // No syncPaths() here on purpose: readConfig has to do it. This is the
    // exact call the flaky suite made, and the exact thing that used to hand
    // back the developer's own config.
    assert.equal(readConfig().super_agent.model, "sandbox:model");
  });
});

test("a write lands in the sandbox and never touches the real config", () => {
  const { apx } = sandbox("writeconfig");
  const realPath = paths.CONFIG_PATH;
  const realBefore = fs.existsSync(realPath) ? fs.readFileSync(realPath, "utf8") : null;

  withHome(apx, () => {
    const cfg = readConfig();
    cfg.super_agent.model = "sandbox:written";
    writeConfig(cfg);
    assert.equal(readConfig().super_agent.model, "sandbox:written");
  });

  const realAfter = fs.existsSync(realPath) ? fs.readFileSync(realPath, "utf8") : null;
  assert.equal(realAfter, realBefore, "the real config is untouched");
});

test("a stubbed homedir is honoured too, not just APX_HOME", () => {
  // The older isolation trick, and the one config/index.js documents as
  // insufficient on its own — it has to be insufficient for the right reason
  // (the env var wins), not because the paths are frozen.
  const { home, apx } = sandbox("homedir");
  const realHomedir = os.homedir;
  const prevEnv = process.env.APX_HOME;
  delete process.env.APX_HOME;
  os.homedir = () => home;
  try {
    assert.equal(paths.syncPaths(), true);
    assert.equal(paths.APX_HOME, apx);
  } finally {
    os.homedir = realHomedir;
    if (prevEnv !== undefined) process.env.APX_HOME = prevEnv;
    paths.syncPaths();
  }
});

test("syncPaths is a no-op when nothing moved", () => {
  assert.equal(paths.syncPaths(), false);
  assert.equal(paths.syncPaths(), false);
});
