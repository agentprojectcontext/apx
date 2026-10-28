// The code and SQL steps' processes on their own: what code can reach, what a statement may do, and their limits.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runFlowCode, runFlowSql } from "./flow-work-steps.ts";
import { tempDir } from "./testkit/platform.ts";

const code = (src: string, input: unknown = { n: 2 }, timeoutMs = 3000) =>
  runFlowCode({ code: src, input, vars: { k: "v" }, timeoutMs });
const value = (end: Awaited<ReturnType<typeof runFlowCode>>) =>
  end.answer?.ok && typeof end.answer.json === "string" ? JSON.parse(end.answer.json) : end.answer;

test("code returns JSON from its input and variables, and an error comes back as its message", async () => {
  assert.deepEqual(value(await code("return { double: input.n * 2, k: vars.k, at: typeof Date.now() }")), {
    double: 4,
    k: "v",
    at: "number",
  });
  assert.equal(value(await code("input.n++")), null);
  const thrown = (await code("throw new Error('no tier for ' + input.n)")).answer;
  assert.deepEqual(thrown, { ok: false, error: "code_failed", message: "no tier for 2" });
  const syntax = (await code("return {")).answer;
  assert.equal(syntax?.ok, false);
  assert.match((syntax as { message?: string }).message ?? "", /Unexpected/);
  assert.match((await code("return Promise.resolve(1)")).answer?.ok === false ? "promise" : "", /promise/);
});

test("code reaches no file, network, process or host object, and makes no code from text", async () => {
  const dir = tempDir();
  const secret = path.join(dir.path, "secret.txt");
  fs.writeFileSync(secret, "top secret");
  try {
    const typeofs = value(
      await code(
        `return [typeof require, typeof process, typeof fetch, typeof globalThis.process, typeof module,
          typeof setTimeout, typeof WebAssembly === "object" ? "wasm" : "none", typeof this]`,
      ),
    );
    assert.deepEqual(typeofs.slice(0, 6), [
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
    ]);
    assert.equal(typeofs[7], "undefined");
    for (const attempt of [
      `return this.constructor.constructor("return process")()`,
      `return (() => {}).constructor("return process")()`,
      `return (async () => {}).constructor("return process")()`,
      `return Function("return process")()`,
      `return eval("process")`,
      `return globalThis.constructor.constructor("return process")()`,
      `return __f.constructor("return process.mainModule.require('fs').readFileSync('${secret}', 'utf8')")()`,
      `Error.prepareStackTrace = (e, frames) => frames.map((f) => typeof f.getThis()); return new Error().stack`,
      `return new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))`,
      `return import("node:fs").then((fs) => fs.readFileSync("${secret}", "utf8"))`,
      `const r = []; try { r.push(arguments.callee.caller) } catch (e) { r.push("strict") } return r`,
    ]) {
      const end = await code(attempt);
      const out = JSON.stringify(end.answer);
      assert.doesNotMatch(out, /top secret/, attempt);
      assert.ok(end.answer?.ok === false || /strict|null|\[\]|\{\}/.test(out), `${attempt}: ${out}`);
    }
  } finally {
    await dir.remove();
  }
});

test("code has a time limit, a memory limit and a cap on what it returns", async () => {
  const loop = await code("for (;;) {}", null, 2000);
  assert.deepEqual(loop.answer, { ok: false, error: "code_timeout" });
  // Promises that never stop run in the code's own time too: it ends without an answer.
  const micro = await code("const spin = () => Promise.resolve().then(spin); spin(); return 1", null, 2000);
  assert.notEqual(micro.answer?.ok, true);
  const blocked = await code("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); return 1", null, 2000);
  assert.ok(blocked.timedOut || blocked.answer?.ok === false);
  const memory = await code("const a = []; for (;;) a.push(new Array(1e6).fill(1.5));", null, 8000);
  assert.ok(!memory.answer?.ok, "a heap that grows past its limit ends the process");
  const big = await code(`return "x".repeat(200000)`);
  assert.equal(big.tooLarge, true);
});

/** A project folder with a small SQLite database, and a second file outside it. */
function databases() {
  const dir = tempDir();
  const project = path.join(dir.path, "project");
  fs.mkdirSync(path.join(project, "data"), { recursive: true });
  const file = path.join(project, "data", "crm.db");
  const outside = path.join(dir.path, "outside.db");
  for (const f of [file, outside]) {
    const db = new DatabaseSync(f);
    db.exec("CREATE TABLE people (email TEXT PRIMARY KEY, name TEXT, plan TEXT)");
    const add = db.prepare("INSERT INTO people VALUES (?, ?, ?)");
    for (let i = 0; i < 50; i++) add.run(`p${i}@example.com`, `Person ${i}`, i % 2 ? "pro" : "free");
    db.close();
  }
  return { dir, project, file, outside };
}
const sql = (
  file: string,
  mode: "read" | "write",
  query: string,
  params: Record<string, unknown> = {},
  maxRows = 100,
) => runFlowSql({ file, mode, query, params, maxRows, timeoutMs: 5000 });
const count = (file: string) =>
  Number(
    (new DatabaseSync(file, { readOnly: true }).prepare("SELECT count(*) c FROM people").get() as { c: number }).c,
  );

test("a SQL value is always bound: what arrived can't change the statement", async () => {
  const { dir, file } = databases();
  try {
    const q = "SELECT name FROM people WHERE email = :email";
    const ok = await sql(file, "read", q, { email: "p3@example.com" });
    assert.deepEqual(ok.answer, {
      ok: true,
      value: { columns: ["name"], rows: [{ name: "Person 3" }], count: 1, truncated: false },
    });
    for (const email of ["x' OR '1'='1", "'; DROP TABLE people; --", "p3@example.com' --", '" OR 1=1 --']) {
      const end = await sql(file, "read", q, { email });
      assert.deepEqual((end.answer as { value?: { rows: unknown[] } }).value?.rows, [], email);
    }
    const write = await sql(file, "write", "UPDATE people SET plan = :plan WHERE email = :email", {
      plan: "gold'); DELETE FROM people; --",
      email: "p1@example.com",
    });
    assert.deepEqual(write.answer, { ok: true, value: { changes: 1, last_id: 0 } });
    assert.equal(count(file), 50);
  } finally {
    await dir.remove();
  }
});

test("a statement can't reach another file, change settings, load code or run twice; a read can't write", async () => {
  const { dir, file, outside } = databases();
  try {
    for (const [mode, query] of [
      ["read", `ATTACH DATABASE '${outside}' AS o`],
      ["write", `ATTACH DATABASE '${outside}' AS o`],
      ["write", `VACUUM INTO '${path.join(dir.path, "copy.db")}'`],
      ["read", `VACUUM INTO '${path.join(dir.path, "copy.db")}'`],
      ["write", "PRAGMA writable_schema = ON"],
      ["read", "PRAGMA table_info(people)"],
      ["read", "SELECT load_extension('/tmp/evil')"],
      ["read", "SELECT 1; DELETE FROM people"],
      ["write", "SELECT 1; DELETE FROM people"],
      ["read", "DELETE FROM people"],
      ["read", "WITH x AS (SELECT 1) DELETE FROM people"],
      ["read", "INSERT INTO people VALUES ('a', 'b', 'c') RETURNING *"],
      ["write", "DROP TABLE people"],
      ["write", "CREATE TRIGGER t AFTER INSERT ON people BEGIN DELETE FROM people; END"],
      ["write", "CREATE TEMP TABLE t (x)"],
      ["write", "ALTER TABLE people ADD COLUMN x"],
      ["write", "BEGIN"],
      ["write", "  /* hidden */ -- also\n VACUUM"],
    ] as const) {
      const end = await sql(file, mode, query);
      assert.equal(end.answer?.ok, false, `${mode}: ${query}`);
    }
    assert.equal(count(file), 50);
    assert.ok(!fs.existsSync(path.join(dir.path, "copy.db")));
    // A write may add a table and an index, and say what it changed.
    const made = await sql(file, "write", "CREATE TABLE IF NOT EXISTS seen (id INTEGER PRIMARY KEY, at TEXT)");
    assert.equal(made.answer?.ok, true);
    const back = await sql(file, "write", "INSERT INTO seen (at) VALUES (:at) RETURNING id", { at: "now" });
    assert.deepEqual((back.answer as { value: unknown }).value, {
      columns: ["id"],
      rows: [{ id: 1 }],
      count: 1,
      truncated: false,
      changes: 1,
      last_id: 1,
    });
  } finally {
    await dir.remove();
  }
});

test("a read caps its rows and bytes, and a query that runs away is stopped", async () => {
  const { dir, file } = databases();
  try {
    const capped = await sql(file, "read", "SELECT * FROM people", {}, 10);
    const v = (capped.answer as { value: { rows: unknown[]; truncated: boolean } }).value;
    assert.equal(v.rows.length, 10);
    assert.equal(v.truncated, true);
    const wide = await sql(file, "read", "SELECT printf('%.5000c', 'x') AS big FROM people", {}, 500);
    const w = (wide.answer as { value: { rows: unknown[]; truncated: boolean } }).value;
    assert.ok(w.rows.length < 10 && w.truncated);
    const runaway = await runFlowSql({
      file,
      mode: "read",
      query: "WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c) SELECT count(*) FROM c",
      params: {},
      maxRows: 10,
      timeoutMs: 2000,
    });
    assert.equal(runaway.timedOut, true);
  } finally {
    await dir.remove();
  }
});
