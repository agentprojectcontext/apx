// The coding loop's own tools: a paged, numbered read_file; apply_patch in the
// format GPT/Codex models write; a checklist; a curated tool set; and a session
// history that remembers what the previous turn actually did.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readFile from "#core/agent/tools/handlers/read-file.js";
import applyPatch from "#core/agent/tools/handlers/apply-patch.js";
import todoWrite from "#core/agent/tools/handlers/todo-write.js";
import { parsePatch, applyChunks, PatchError } from "#core/agent/tools/patch/apply-patch.js";
import { createToolSession } from "#core/agent/tools/registry.js";
import { codeSessionHistory } from "#core/stores/code-sessions.js";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-coding-"));
  return { dir, projects: { get: () => ({ id: 0, path: dir }), list: () => [{ id: 0 }] } };
}

test("read_file pages a large file with line numbers and a next_offset", () => {
  const { dir, projects } = project();
  fs.writeFileSync(path.join(dir, "big.txt"), Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  const read = readFile.makeHandler({ projects });
  const first = read({ path: "big.txt" });
  assert.equal(first.total_lines, 2500);
  assert.equal(first.to, 2000);
  assert.equal(first.next_offset, 2001);
  assert.match(first.content.split("\n")[0], /^\s*1\tline 1$/);
  const second = read({ path: "big.txt", offset: first.next_offset, limit: 10 });
  assert.match(second.content.split("\n")[0], /^2001\tline 2001$/);
  assert.equal(second.to, 2010);
  assert.match(read({ path: "big.txt", offset: 9999 }).error, /past the end/);
});

test("apply_patch parses every operation of the Codex format", () => {
  const ops = parsePatch([
    "*** Begin Patch",
    "*** Add File: src/new.js",
    "+export const a = 1;",
    "*** Update File: src/app.js",
    "*** Move to: src/main.js",
    "@@ function start",
    " const x = 1;",
    "-const y = 2;",
    "+const y = 3;",
    "*** Delete File: src/old.js",
    "*** End Patch",
  ].join("\n"));
  assert.deepEqual(ops.map((o) => o.type), ["add", "update", "delete"]);
  assert.equal(ops[1].moveTo, "src/main.js");
  assert.equal(ops[1].chunks[0].anchor, "function start");
  assert.throws(() => parsePatch("no header"), PatchError);
});

test("hunks land despite stray whitespace, and a miss says what was not found", () => {
  const out = applyChunks("a\n  b  \nc\n", [{ anchor: "", old: ["a", "b", "c"], new: ["a", "B", "c"] }], "f");
  assert.equal(out, "a\nB\nc\n");
  assert.throws(() => applyChunks("a\n", [{ anchor: "", old: ["zzz"], new: ["y"] }], "f"), /could not find the lines/);
});

test("apply_patch writes all files or none", async () => {
  const { dir, projects } = project();
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "math.js"), "export function sum(list) {\n  let t = 0;\n  for (let i = 1; i < list.length; i++) t += list[i];\n  return t;\n}\n");
  const patch = applyPatch.makeHandler({ projects, requirePermission: async () => {} });
  const bad = await patch({ patch: [
    "*** Begin Patch",
    "*** Add File: src/extra.js",
    "+export const extra = true;",
    "*** Update File: src/math.js",
    "-this line is not in the file",
    "+nope",
    "*** End Patch",
  ].join("\n") });
  assert.equal(bad.applied, false);
  assert.ok(!fs.existsSync(path.join(dir, "src", "extra.js")), "the first file was not written either");

  const good = await patch({ patch: [
    "*** Begin Patch",
    "*** Update File: src/math.js",
    "   let t = 0;",
    "-  for (let i = 1; i < list.length; i++) t += list[i];",
    "+  for (let i = 0; i < list.length; i++) t += list[i];",
    "*** Add File: src/extra.js",
    "+export const extra = true;",
    "*** End Patch",
  ].join("\n") });
  assert.ok(good.ok);
  assert.match(fs.readFileSync(path.join(dir, "src", "math.js"), "utf8"), /let i = 0;/);
  assert.equal(fs.readFileSync(path.join(dir, "src", "extra.js"), "utf8"), "export const extra = true;\n");
});

test("todo_write keeps the whole list and summarises it", () => {
  const session = {};
  const r = todoWrite.makeHandler({ toolSession: session })({ todos: [
    { content: "reproduce", status: "completed" },
    { content: "fix", status: "in_progress" },
    { content: "run tests", status: "weird" },
  ] });
  assert.equal(r.summary, "1/3 done, working on: fix");
  assert.equal(session.todos[2].status, "pending", "unknown status falls back to pending");
});

test("a coding session starts on the coding tools, not the whole registry", () => {
  const names = new Set(createToolSession("code").initialSchemas.map((s) => s.function?.name || s.name));
  for (const t of ["read_file", "apply_patch", "edit_file", "run_shell", "todo_write", "grep", "git_diff", "discover_tools"]) {
    assert.ok(names.has(t), `${t} is loaded`);
  }
  for (const t of ["send_whatsapp", "calendar_create_event", "browser_click"]) {
    assert.ok(!names.has(t), `${t} waits behind discover_tools`);
  }
  assert.ok(names.size <= 40);
});

test("a code session's history keeps what the last turn did, on the system side", () => {
  const history = codeSessionHistory({ messages: [
    { role: "user", parts: [{ kind: "text", text: "fix sum" }] },
    { role: "assistant", parts: [
      { kind: "tool", tool: "read_file", args: { path: "math.js" }, result: { content: "1\tcode" } },
      { kind: "tool", tool: "apply_patch", args: { patch: "…" }, result: { ok: true } },
      { kind: "text", text: "Fixed." },
    ] },
  ] });
  assert.deepEqual(history.map((m) => m.role), ["user", "system", "assistant"]);
  assert.match(history[1].content, /Tool log/);
  assert.match(history[1].content, /read_file.*math\.js/);
  assert.match(history[1].content, /apply_patch/);
  assert.equal(history[2].content, "Fixed.");
});
