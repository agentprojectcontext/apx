import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AGENTS_MD_LIMIT } from "@apx/protocol";
import { cap, readProject } from "./read.ts";

test("a cap preserves boundary-sized text and names the exact omitted lines for a path with spaces", () => {
  const exact = "x".repeat(AGENTS_MD_LIMIT);
  assert.equal(cap(exact, "~/work/sample project/AGENTS.md"), exact);
  const rows = Array.from({ length: 400 }, (_, i) => `Rule ${i}: ${"x".repeat(10)}`);
  const text = `${rows.join("\n")}\n`;
  const file = "~/work/sample project/AGENTS.md";
  const capped = cap(text, file, 2_000);
  const match = /\[… lines (\d+)-(\d+) of (.+) \((\d+) of its (\d+) characters\).*offset=(\d+) limit=(\d+)/.exec(
    capped,
  );
  assert.ok(match);
  const from = Number(match[1]);
  const to = Number(match[2]);
  const omitted = rows.slice(from - 1, to).join("\n");
  assert.equal(match[3], file);
  assert.equal(Number(match[4]), omitted.length + 1);
  assert.equal(Number(match[5]), text.length);
  assert.equal(Number(match[6]), from);
  assert.equal(Number(match[7]), to - from + 1);
  assert.equal(capped.split("\n[…")[0], `${rows.slice(0, from - 1).join("\n")}\n`);
  assert.ok(capped.endsWith(`${rows.slice(to).join("\n")}\n`));
  assert.ok(!capped.includes(rows[from] ?? "missing rule"));
});

test("project Markdown respects safety boundaries, BOMs, and removal without importing symlink targets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-context-read-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "apx-context-outside-"));
  const rules = path.join(root, "AGENTS.md");
  const memory = path.join(root, ".apc", "memory.md");
  try {
    fs.mkdirSync(path.dirname(memory));
    const exact = "x".repeat(AGENTS_MD_LIMIT);
    fs.writeFileSync(rules, `\uFEFF${exact}\n`);
    fs.writeFileSync(memory, `${exact}\n`);
    assert.equal(readProject(root).context, exact);
    assert.equal(readProject(root).memory, exact);
    assert.equal(readProject(root).contextChars, undefined);

    const huge = Array.from({ length: 5_000 }, (_, i) => `Project note ${i}: ${"x".repeat(35)}`).join("\n");
    fs.writeFileSync(memory, huge);
    const project = readProject(root);
    assert.ok(project.memory?.includes("are not shown here"));
    assert.ok(project.memory?.includes("Project note 0:"));
    assert.ok(project.memory?.endsWith("x".repeat(35)));
    assert.ok(project.memory?.includes(memory));

    fs.unlinkSync(rules);
    fs.unlinkSync(memory);
    const target = path.join(outside, "private.txt");
    fs.writeFileSync(target, "Do not import this content.");
    fs.symlinkSync(target, rules);
    fs.symlinkSync(target, memory);
    assert.equal(readProject(root).context, undefined);
    assert.equal(readProject(root).memory, undefined);
    assert.equal(readProject(root).contextChars, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
