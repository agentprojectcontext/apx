// regenerateAgentsMd() rebuilds AGENTS.md from .apc/agents/*.md for Codex
// compat — EXCEPT in the apx source repo itself, whose AGENTS.md is a
// hand-maintained dev guide. This test pins both behaviors.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { regenerateAgentsMd } from "../src/core/scaffold.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

test("regenerateAgentsMd rebuilds AGENTS.md for a normal APC project", () => {
  const root = makeTempProject({
    name: "User Project",
    agents: [{ slug: "writer", role: "drafts copy" }],
  });
  try {
    regenerateAgentsMd(root);
    const md = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    assert.match(md, /^# Agents/m);
    assert.match(md, /## writer/);
    assert.match(md, /## Project rules/); // footer is injected
  } finally {
    cleanupTempProject(root);
  }
});

test("regenerateAgentsMd leaves the apx source repo's hand-maintained AGENTS.md alone", () => {
  const root = makeTempProject({ name: "apx", agents: [{ slug: "cody", role: "x" }] });
  try {
    // Mark this temp tree as the apx source package.
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@agentprojectcontext/apx" })
    );
    const handWritten = "# AGENTS.md — developer guide\n\nhand-maintained, do not clobber\n";
    fs.writeFileSync(path.join(root, "AGENTS.md"), handWritten);

    regenerateAgentsMd(root);

    assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), handWritten);
  } finally {
    cleanupTempProject(root);
  }
});

test("the guard keys off the package name, not the project name", () => {
  // A user project literally named "apx" must still be regenerated.
  const root = makeTempProject({ name: "apx", agents: [{ slug: "bob", role: "y" }] });
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "my-cool-app" })
    );
    regenerateAgentsMd(root);
    const md = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    // The auto-generated header is proof regeneration ran (makeTempProject
    // does not write it) — i.e. the guard did NOT skip this project.
    assert.match(md, /Auto-generated from \.apc\/agents/);
    assert.match(md, /## bob/);
    assert.match(md, /## Project rules/);
  } finally {
    cleanupTempProject(root);
  }
});
