import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAllowlist, type PortabilityFinding, scanPortability, shrinkAllowlist } from "./test-portability.ts";

// Sources write a template's `${` as `$[`, so this file holds no template syntax inside plain strings.
const rules = (file: string, source: string) => scanPortability(file, source.replaceAll("$[", "${")).map((f) => f.rule);
const TEST = "apps/core/src/acme.test.ts";
const PRODUCT = "apps/core/src/acme.ts";

test("tests: hand-made temp folders, raw recursive removal, local waits and counted polls are found", () => {
  assert.deepEqual(rules(TEST, 'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acme-"));'), ["raw-mkdtemp"]);
  assert.deepEqual(rules(TEST, "after(() => fs.rmSync(dir, { recursive: true, force: true }));"), ["raw-rm"]);
  assert.deepEqual(rules(TEST, "await fs.promises.rm(dir, { recursive: true });"), ["raw-rm"]);
  assert.deepEqual(
    rules(TEST, "const until = async (ok) => { while (!ok()) await new Promise((r) => setTimeout(r, 20)); };"),
    ["local-wait"],
  );
  assert.deepEqual(rules(TEST, "async function waitFor(ok) { for (;;) { if (ok()) return; await sleep(10); } }"), [
    "local-wait",
  ]);
  assert.deepEqual(rules(TEST, "for (let i = 0; i < 200 && !done; i++) await new Promise((r) => setTimeout(r, 10));"), [
    "counted-poll",
  ]);
});

test("tests: what is not one of those passes", () => {
  for (const source of [
    'fs.rmSync(path.join(dir, "a.txt"), { force: true });',
    'const sub = fs.mkdtempSync(path.join(root, "bin-"));',
    "const until = (ok) => waitFor(ok, 'the step');",
    "const wait = (ms) => new Promise((r) => setTimeout(r, ms));",
    "for (let i = 0; i < 3; i++) await send(i);",
    "while (!ok()) await waitFor(ok);",
  ])
    assert.deepEqual(rules(TEST, source), [], source);
});

test("tests: a real-time window under 2 s is found unless the clock is injected", () => {
  assert.deepEqual(rules(TEST, "await startCore({ llm, turnIdleMs: 300 });"), ["short-window"]);
  assert.deepEqual(rules(TEST, "const IDLE = 800;\nawait startCore({ llm, a2aCapMs: IDLE });"), ["short-window"]);
  assert.deepEqual(rules(TEST, "await startCore({ llm, roomBurstMs: 50, roomBurstMS: 2500 });"), ["short-window"]);
  assert.deepEqual(rules(TEST, "await startCore({ llm, turnIdleMs: 300, runTimers: timers });"), []);
  assert.deepEqual(rules(TEST, "await startCore({ llm, engineIdleMs: 5000 });"), []);
});

test("product: path prefixes and process.exit are found; their own homes and literal prefixes are not", () => {
  assert.deepEqual(rules(PRODUCT, "if (p.startsWith(`$[root}$[path.sep}`)) go();"), ["path-prefix"]);
  assert.deepEqual(rules(PRODUCT, "if (p.startsWith(`$[home}/`)) go();"), ["path-prefix"]);
  assert.deepEqual(rules(PRODUCT, "if (p.startsWith(root + path.sep)) go();"), ["path-prefix"]);
  assert.deepEqual(rules(PRODUCT, "process.exit(1);"), ["process-exit"]);
  assert.deepEqual(rules(PRODUCT, 'if (rel.startsWith("..")) stop(); if (u.startsWith(`$[base}?q=`)) go();'), []);
  assert.deepEqual(rules("apps/core/src/paths.ts", "p.startsWith(`$[root}/`);"), []);
  assert.deepEqual(rules("packages/protocol/src/exit.ts", "process.exit(code);"), []);
  // Tests may exit a child script they spawn; scripts and docs are not product code.
  assert.deepEqual(rules(TEST, "process.exit(0);"), []);
  assert.deepEqual(rules("scripts/perf.ts", "process.exit(1);"), []);
});

test("a marked exception passes, on its line or the line above", () => {
  assert.deepEqual(rules(PRODUCT, "process.exit(2); // portable: no handle is open before the arguments parse"), []);
  assert.deepEqual(rules(PRODUCT, "// portable: the askpass child has nothing open\nprocess.exit(1);"), []);
  // A real-time window is never excused by a comment: only injected timers make it pass.
  assert.deepEqual(rules(TEST, "// portable: 1 ms is shorter than any start\nawait probe({ timeoutMs: 1 });"), [
    "short-window",
  ]);
});

test("the allowlist only shrinks: a new hit fails, and so does an allowance no file needs any more", () => {
  const hit = (file: string): PortabilityFinding => ({ file, line: 1, rule: "raw-rm", reason: "" });
  const allow = { "raw-rm": { "a.test.ts": 2, "b.test.ts": 1 } };
  assert.deepEqual(checkAllowlist([hit("a.test.ts"), hit("a.test.ts"), hit("b.test.ts")], allow), {
    extra: [],
    stale: [],
  });
  assert.equal(
    checkAllowlist([hit("a.test.ts"), hit("b.test.ts"), hit("c.test.ts")], allow).extra[0]?.file,
    "c.test.ts",
  );
  assert.deepEqual(checkAllowlist([hit("a.test.ts"), hit("a.test.ts")], allow).stale, [
    "b.test.ts: raw-rm allows 1, found 0",
  ]);
  assert.deepEqual(shrinkAllowlist(allow, [hit("a.test.ts"), hit("c.test.ts")]), { "raw-rm": { "a.test.ts": 1 } });
});
