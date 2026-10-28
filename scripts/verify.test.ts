import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { clock, expand, PLANS, progress, readHistory, runSteps, type Step, statusLine } from "./verify.ts";

const CLEAR = "\r\x1b[2K";
const node = (code: string) => `node -e "${code}"`;
const step = (label: string, code = ""): Step => ({ label, command: node(code) });

function sink(isTTY = false) {
  let text = "";
  const write = (s: string) => {
    text += s;
    return true;
  };
  return { out: { isTTY, columns: 120, write }, text: () => text };
}

/** A clock that moves one second each time it is read. */
const ticking = () => {
  let t = 0;
  return () => (t += 1000);
};

function cache(t: { after(fn: () => void): void }) {
  const dir = tempDir("apx-verify-");
  t.after(dir.remove);
  return dir.path;
}

test("a plan expands chained root scripts into their parts, in order, without repeating a command", () => {
  const scripts = {
    preflight: "pnpm static && pnpm test",
    static: "pnpm lint && pnpm checks && tsc -p e2e",
    lint: "biome check .",
    checks: "node checks.ts",
    test: "pnpm checks && pnpm -r --if-present test && pnpm mobile",
    mobile: "npm --prefix apps/mobile test",
  };
  assert.deepEqual(
    expand(["pnpm preflight", "node --no-warnings scripts/perf.ts"], scripts).map((s) => [s.label, s.command]),
    [
      ["lint", "pnpm lint"],
      ["checks", "pnpm checks"],
      ["static › tsc -p e2e", "tsc -p e2e"],
      ["test › unit tests (every package)", "pnpm -r --if-present test"],
      ["mobile", "pnpm mobile"],
      ["perf budgets", "node --no-warnings scripts/perf.ts"],
    ],
  );
  const root = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const verify = expand(PLANS.verify ?? [], root.scripts).map((s) => s.command);
  const preflight = expand(PLANS.preflight ?? [], root.scripts).map((s) => s.command);
  assert.deepEqual(verify.slice(0, preflight.length), preflight);
  assert.ok(verify.includes("pnpm test:coverage:all"));
  assert.ok(!verify.some((c) => /scripts\/verify\.ts/.test(c)), "the runner never runs itself");
});

test("steps run in order, the first failure stops the run with its exit code", async (t) => {
  const dir = cache(t);
  const marks = path.join(dir, "marks.txt");
  const mark = (n: number) => `require('fs').appendFileSync(process.argv[1], '${n}')`;
  const steps: Step[] = [
    { label: "one", command: `node -e "${mark(1)}" "${marks}"` },
    { label: "two", command: `node -e "${mark(2)}" "${marks}"` },
    step("three", "process.exit(3)"),
    { label: "four", command: `node -e "${mark(4)}" "${marks}"` },
  ];
  const { out, text } = sink();
  const code = await runSteps({ name: "verify", steps, root: dir, cacheDir: dir, out, live: false, now: ticking() });
  assert.equal(code, 3);
  assert.equal(fs.readFileSync(marks, "utf8"), "12");
  assert.match(text(), /✗ 3\/4 three {2}exit 3/);
  assert.match(text(), /verify failed at step 3\/4/);
  assert.doesNotMatch(text(), /four/);
});

test("outside a terminal it prints one plain line per step start and end, never a redraw", async (t) => {
  const dir = cache(t);
  const { out, text } = sink();
  const steps = [step("lint"), step("typecheck")];
  assert.equal(
    await runSteps({ name: "preflight", steps, root: dir, cacheDir: dir, out, live: false, now: ticking() }),
    0,
  );
  const lines = text().trimEnd().split("\n");
  assert.equal(lines[0], "preflight: 2 steps");
  assert.equal(lines[1], "▶ 1/2 lint");
  assert.match(lines[2] ?? "", /^✓ 1\/2 lint {2}\d+s {2}\(total \d+s\)$/);
  assert.equal(lines[3], "▶ 2/2 typecheck");
  assert.match(lines.at(-1) ?? "", /^preflight passed in \d+s$/);
  assert.ok(!text().includes("\r") && !text().includes("\x1b"));
});

test("the second run estimates the time left from the first one's step durations", async (t) => {
  const dir = cache(t);
  const steps = [step("lint"), step("typecheck"), step("tests")];
  const first = sink();
  await runSteps({ name: "verify", steps, root: dir, cacheDir: dir, out: first.out, live: false, now: ticking() });
  assert.doesNotMatch(first.text(), /left/);
  const history = readHistory(path.join(dir, "history.json"));
  assert.deepEqual(
    Object.keys(history),
    steps.map((s) => s.command).filter((c, i, a) => a.indexOf(c) === i),
  );

  const second = sink();
  await runSteps({ name: "verify", steps, root: dir, cacheDir: dir, out: second.out, live: false, now: ticking() });
  assert.match(second.text(), /^verify: 3 steps, about \d+s last time$/m);
  assert.match(second.text(), /✓ 1\/3 lint .*~\d+s left\)/);
});

test("progress weighs steps by their past durations and gives no estimate while one is unknown", () => {
  const steps = [step("a", "1"), step("b", "2"), step("c", "3")];
  const history = { [node("1")]: 10_000, [node("2")]: 60_000, [node("3")]: 30_000 };
  assert.deepEqual(progress(steps, history, 0, 0), { fraction: 0, left: 100_000 });
  assert.deepEqual(progress(steps, history, 1, 30_000), { fraction: 0.4, left: 60_000 });
  // A step running over its estimate holds at its share instead of counting down past it.
  assert.deepEqual(progress(steps, history, 1, 90_000), { fraction: 0.7, left: 30_000 });
  assert.deepEqual(progress(steps, { [node("1")]: 10_000 }, 1, 5_000), { fraction: 1 / 3, left: undefined });
});

test("the live line shows step k of N, a bar, the timers and the time left, cut to the terminal", () => {
  const status = { index: 3, total: 12, label: "lint", stepElapsed: 12_000, totalElapsed: 185_000, fraction: 0.38 };
  const line = statusLine({ ...status, left: 250_000 });
  assert.match(line, /^4\/12 █{8}░{12} {2}38% {2}3:05 · ~4:10 left │ lint 12s$/);
  assert.doesNotMatch(statusLine({ ...status, left: undefined }), /left/);
  assert.match(statusLine({ ...status, left: 1 }, 0), /│ lint 12s$/);
  assert.ok(statusLine({ ...status, left: 1, label: "x".repeat(200) }, 60).length <= 59);
  assert.deepEqual([clock(9_400), clock(245_000), clock(3_723_000)], ["9s", "4:05", "1:02:03"]);
});

test("in a terminal the output goes to a log and only a failing step's is shown", async (t) => {
  const dir = cache(t);
  const { out, text } = sink(true);
  const steps = [
    step("quiet", "console.log('hidden output')"),
    step("loud", "console.error('it broke'); process.exit(2)"),
  ];
  const code = await runSteps({ name: "verify", steps, root: dir, cacheDir: dir, out, live: true, now: ticking() });
  assert.equal(code, 2);
  assert.ok(text().includes(`${CLEAR}1/2 `));
  assert.doesNotMatch(text(), /hidden output/);
  assert.match(text().replaceAll(CLEAR, ""), /✗ 2\/2 loud {2}exit 2[^\n]*\nit broke\nFull output: .*02-loud\.log/);
});

test("an aborted run starts no further step", async (t) => {
  const dir = cache(t);
  const stop = new AbortController();
  stop.abort();
  const { out, text } = sink();
  const options = {
    name: "verify",
    steps: [step("lint")],
    root: dir,
    cacheDir: dir,
    out,
    live: false,
    signal: stop.signal,
  };
  assert.equal(await runSteps(options), 130);
  assert.match(text(), /verify interrupted before step 1\/1/);
});
