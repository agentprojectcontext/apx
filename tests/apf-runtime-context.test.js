import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildApfHint,
  createRuntimeSession,
  closeRuntimeSession,
  extractApfResult,
} from "../src/host/daemon/apc-runtime-context.js";
import { readSessionFrontmatter } from "../src/core/stores/sessions.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

test("buildApfHint substitutes the placeholders", () => {
  const hint = buildApfHint({
    projectName: "Test",
    projectPath: "/tmp/foo",
    agentSlug: "sofia",
    sessionId: "2026-05-08-01",
  });
  assert.match(hint, /\*\*Project\*\*: Test  \(\/tmp\/foo\)/);
  assert.match(hint, /\*\*Agent\*\*: sofia/);
  assert.match(hint, /\*\*APC session id\*\*: 2026-05-08-01/);
  assert.match(hint, /apx session close 2026-05-08-01/);
  // Should not contain any leftover {{...}} mustache markers
  assert.doesNotMatch(hint, /\{\{/);
});

test("createRuntimeSession + readSessionFrontmatter roundtrip", () => {
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  try {
    const s = createRuntimeSession({
      projectRoot: root,
      agentSlug: "sofia",
      runtime: "claude-code",
      taskRef: "TASK-9",
    });
    assert.match(s.id, /^\d{4}-\d{2}-\d{2}-\d{2}$/);
    assert.equal(path.basename(s.path), `${s.id}.md`);

    const { fm } = readSessionFrontmatter(s.path);
    assert.equal(fm.id, s.id);
    assert.equal(fm.agent, "sofia");
    assert.equal(fm.runtime, "claude-code");
    assert.equal(fm.task_ref, "TASK-9");
    assert.match(fm.status, /In progress/);
  } finally {
    cleanupTempProject(root);
  }
});

test("closeRuntimeSession writes external_session_path + completed status", () => {
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  try {
    const s = createRuntimeSession({
      projectRoot: root,
      agentSlug: "sofia",
      runtime: "claude-code",
    });
    closeRuntimeSession({
      filePath: s.path,
      externalSessionPath: "/tmp/transcript.jsonl",
      exitCode: 0,
      result: "did the thing",
    });
    const { fm } = readSessionFrontmatter(s.path);
    assert.equal(fm.external_session_path, "/tmp/transcript.jsonl");
    assert.match(fm.status, /✅ Completed/);
    assert.match(fm.result, /✅ exit 0/);
    assert.match(fm.result, /did the thing/);
    assert.ok(fm.completed, "completed timestamp should be set");
  } finally {
    cleanupTempProject(root);
  }
});

test("closeRuntimeSession marks failures with ⚠️ Closed with error", () => {
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  try {
    const s = createRuntimeSession({
      projectRoot: root,
      agentSlug: "sofia",
      runtime: "codex",
    });
    closeRuntimeSession({
      filePath: s.path,
      exitCode: 1,
      result: "broke",
    });
    const { fm } = readSessionFrontmatter(s.path);
    assert.match(fm.status, /⚠️ Closed with error/);
    assert.match(fm.result, /⚠️ exit 1/);
  } finally {
    cleanupTempProject(root);
  }
});

test("extractApfResult finds APC_RESULT line in stdout", () => {
  const stdout = `running...
did the thing
APC_RESULT: implemented foo, all tests pass
`;
  assert.equal(extractApfResult(stdout), "implemented foo, all tests pass");
});

test("extractApfResult returns null when no APC_RESULT line", () => {
  assert.equal(extractApfResult("plain output"), null);
  assert.equal(extractApfResult(null), null);
  assert.equal(extractApfResult(""), null);
});

test("createRuntimeSession + closeRuntimeSession sequence — full roundtrip", () => {
  const root = makeTempProject({ agents: [{ slug: "sofia" }] });
  try {
    const s = createRuntimeSession({
      projectRoot: root,
      agentSlug: "sofia",
      runtime: "claude-code",
    });
    closeRuntimeSession({
      filePath: s.path,
      externalSessionPath: "/tmp/x.jsonl",
      exitCode: 0,
      result: "ok",
    });
    const text = fs.readFileSync(s.path, "utf8");
    // Frontmatter still well-formed (starts with ---, ends with ---)
    assert.match(text, /^---\n[\s\S]*?\n---/);
    const { fm } = readSessionFrontmatter(s.path);
    assert.equal(fm.status, "✅ Completed");
    assert.equal(fm.external_session_path, "/tmp/x.jsonl");
  } finally {
    cleanupTempProject(root);
  }
});
