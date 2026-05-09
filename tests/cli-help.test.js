import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI = path.join(__dirname, "..", "src", "cli", "index.js");

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
