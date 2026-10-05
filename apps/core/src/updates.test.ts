import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLog } from "./log.ts";
import { panelEntry } from "./server-wiring.ts";
import { createUpdates, type Runner } from "./updates.ts";

const log = createLog("test", true);
const checkout = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-upd-"));
  fs.mkdirSync(path.join(root, ".git"));
  return root;
};
/** Answers git and pnpm like a checkout three commits behind main. */
const runner = (fail?: string): Runner & { calls: string[] } => {
  const calls: string[] = [];
  const answer = async (cmd: string, args: string[]) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (fail && line.startsWith(fail)) return { code: 1, out: "error: not possible to fast-forward" };
    if (args[0] === "rev-list") return { code: 0, out: "3\n" };
    if (args[0] === "rev-parse") return { code: 0, out: "abc123def456\n" };
    if (args[0] === "log") return { code: 0, out: "feat: whatsapp\nfix: dialogs\n\nfix: cards\n" };
    return { code: 0, out: "ok" };
  };
  return Object.assign(answer, { calls });
};

test("outside a checkout there is nothing to update, and an update says why", async () => {
  const u = createUpdates({ root: os.tmpdir(), log, enabled: true, supervised: false, run: runner() });
  assert.equal((await u.check()).source, "none");
  assert.deepEqual(await u.apply(), { ok: false, restart: false, log: "This APX does not run from a git checkout." });
});

test("a check tells how far behind main the checkout is and what changed", async () => {
  const root = checkout();
  const u = createUpdates({ root, log, enabled: true, supervised: false, run: runner() });
  const s = await u.check();
  assert.equal(s.behind, 3);
  assert.equal(s.latest, "abc123def456");
  assert.deepEqual(s.changes, ["feat: whatsapp", "fix: dialogs", "fix: cards"]);
  assert.ok(s.checked_at);
  assert.deepEqual(u.status(), s);
  fs.rmSync(root, { recursive: true });
});

test("an update pulls fast-forward only, installs and builds; supervised, the core restarts", async () => {
  const root = checkout();
  const run = runner();
  let restarted = false;
  const u = createUpdates({ root, log, enabled: true, supervised: true, run, restart: () => (restarted = true) });
  const r = await u.apply();
  assert.equal(r.ok, true);
  assert.equal(r.restart, true);
  assert.deepEqual(run.calls.slice(0, 3), [
    "git pull --ff-only origin main",
    "pnpm install --frozen-lockfile",
    "pnpm build:web",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(restarted, true);
  fs.rmSync(root, { recursive: true });
});

test("a pull that cannot fast-forward stops the update before installing anything", async () => {
  const root = checkout();
  const run = runner("git pull");
  const u = createUpdates({ root, log, enabled: true, supervised: true, run, restart: () => assert.fail("restarted") });
  const r = await u.apply();
  assert.equal(r.ok, false);
  assert.match(r.log, /not possible to fast-forward/);
  assert.ok(!run.calls.some((c) => c.startsWith("pnpm")));
  fs.rmSync(root, { recursive: true });
});

test("the served panel is known by its entry file, read again when the build changes", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "apx-dist-"));
  const write = (entry: string, at: number) => {
    fs.writeFileSync(path.join(dist, "index.html"), `<script type="module" src="/assets/${entry}"></script>`);
    fs.utimesSync(path.join(dist, "index.html"), at, at);
  };
  write("index-AAA111.js", 1000);
  assert.equal(panelEntry(dist), "index-AAA111.js");
  write("index-BBB222.js", 2000);
  assert.equal(panelEntry(dist), "index-BBB222.js");
  assert.equal(panelEntry(undefined), undefined);
  fs.rmSync(dist, { recursive: true });
});
