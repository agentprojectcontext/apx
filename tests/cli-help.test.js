import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { RUNTIME_IDS, RUNTIME_ALIASES } from "#core/runtimes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI = path.join(__dirname, "..", "src", "interfaces", "cli", "index.js");

function runHelp(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("top-level command help prints command usage without executing command", () => {
  const result = runHelp(["agent", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx agent/);
  assert.match(out, /apx agent <subcommand>/);
  assert.match(out, /add <slug>/);
  assert.equal(result.stderr, "");
});

test("concrete subcommand help prints options and examples", () => {
  const result = runHelp(["agent", "add", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx agent add/);
  assert.match(out, /--role <role>/);
  assert.match(out, /--model <model>/);
  assert.match(out, /apx agent add reviewer/);
  assert.equal(result.stderr, "");
});

test("help command form resolves nested subcommands", () => {
  const result = runHelp(["help", "mcp", "run"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx mcp run/);
  assert.match(out, /<json-args>/);
  assert.match(out, /--project <name\|id\|path>/);
});

test("project command sugar help resolves the inner APX command", () => {
  const result = runHelp(["project", "default", "mcp", "list", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx mcp list/);
  assert.match(out, /Pin command to a specific project/);
});

test("messages chat help documents actor type transcript view", () => {
  const result = runHelp(["messages", "chat", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx messages chat/);
  assert.match(out, /user, agent, tool, or system type/);
  assert.match(out, /--channel <name>/);
});

test("run help lists all supported runtimes", () => {
  const result = runHelp(["run", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  for (const runtime of [
    "claude-code",
    "codex",
    "opencode",
    "aider",
    "cursor-agent",
    "gemini-cli",
    "qwen-code",
  ]) {
    assert.match(out, new RegExp(runtime));
  }
});

test("top-level help uses code command and omits removed aliases", () => {
  const result = runHelp(["--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx code/);
  assert.match(out, /Projects/);
  assert.doesNotMatch(out, /apx sys/);
  assert.doesNotMatch(out, /apx add project/);
  assert.doesNotMatch(out, /apx graph/);
});

test("code help is the terminal assistant help", () => {
  const result = runHelp(["code", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /apx code/);
  assert.match(out, /terminal coding assistant/);
});

// `<to>` was documented in five Notes lines; `<from>` in none. So a coding CLI
// re-deriving the syntax from `--help` had nowhere to learn its own name, went
// looking for a roster of valid senders, found `apx agent list` — which is who
// can RECEIVE — and sent as somebody else. The daemon cannot catch that: the
// name it was handed belongs to a real agent, so it is honoured, filed in that
// agent's project, and stamped with that agent's model. Only the help can.
test("send help says who the SENDER is, with the names that reach an adapter", () => {
  const result = runHelp(["send", "--help"]);
  const out = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(out, /<from> is YOU/);
  // Both halves of the answer: a CLI is its runtime id, an agent is its slug.
  assert.match(out, /runtime id/);
  assert.match(out, /slug/);
  // Every id the registry will actually accept, so the list cannot go stale
  // while a new runtime is added.
  for (const id of RUNTIME_IDS) assert.match(out, new RegExp(id));
  // And the spellings that fold in, so nobody opens a second thread under a
  // second name for the same CLI.
  for (const short of Object.keys(RUNTIME_ALIASES)) {
    assert.match(out, new RegExp(`\\b${short}\\b`), short);
  }
  // The mistake itself, named: `apx agent list` is a list of recipients.
  assert.match(out, /Never borrow a name off `apx agent list`/);
});
