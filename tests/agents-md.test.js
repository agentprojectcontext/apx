// AGENTS.md lifecycle: created ONCE at init as a generic conventions file,
// never regenerated, and never lists APX agents (those live in .apc/agents/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initApf, writeAgentFile, ensureAgentDir } from "../src/core/apc/scaffold.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-agents-md-"));
}

test("initApf writes a generic AGENTS.md, not an agent registry", () => {
  const root = tmpDir();
  try {
    const { agentsMd } = initApf(root, { name: "Demo" });
    const md = fs.readFileSync(agentsMd, "utf8");

    assert.match(md, /# AGENTS\.md/);
    assert.match(md, /Startup rules/i);
    assert.match(md, /## Overview/);
    assert.match(md, /## Conventions/);
    assert.match(md, /## Rules/);
    // No agent blocks: the per-agent field marker must be absent.
    assert.doesNotMatch(md, /\*\*Role\*\*/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("adding an agent does NOT touch AGENTS.md (no regeneration)", () => {
  const root = tmpDir();
  try {
    const { agentsMd } = initApf(root, { name: "Demo" });
    const before = fs.readFileSync(agentsMd, "utf8");

    writeAgentFile(root, "cody", { Role: "code refactor", Model: "claude-sonnet-4-6" });
    ensureAgentDir(root, "cody");

    // Agent lands in .apc/agents/, AGENTS.md is byte-identical.
    assert.ok(fs.existsSync(path.join(root, ".apc", "agents", "cody.md")));
    assert.equal(fs.existsSync(path.join(root, ".apc", "agents", "cody")), false);
    assert.equal(fs.readFileSync(agentsMd, "utf8"), before);
    assert.doesNotMatch(fs.readFileSync(agentsMd, "utf8"), /## cody/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("initApf writes a defensive .apc/.gitignore", () => {
  const root = tmpDir();
  try {
    initApf(root, { name: "Demo" });
    const ignore = fs.readFileSync(path.join(root, ".apc", ".gitignore"), "utf8");
    assert.match(ignore, /agents\/\*\/$/m);
    assert.match(ignore, /mcps\.local\.json/);
    assert.match(ignore, /\*\.secret\.json/);
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /\*\.env\.\*/);
    assert.match(ignore, /service-account\*\.json/);
    assert.match(ignore, /memory\.db/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("initApf does not overwrite an existing hand-written AGENTS.md", () => {
  const root = tmpDir();
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# my own rules\n");
    initApf(root, { name: "Demo" });
    assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "# my own rules\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
