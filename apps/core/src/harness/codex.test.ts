import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { codexHarness } from "./codex.ts";
import { fakeProgram } from "./fake-program.test-support.ts";
import type { TurnIO } from "./types.ts";
import { linkedWorktreeWritableDirs } from "./worktree.ts";

/** A main checkout with a linked worktree, made with real git; nothing from a calling git (GIT_*) reaches it. */
type Fixture = { root: string; main: string; worktree: string; common: string; gitDir: string; expected: string[] };
let fx: Fixture;
let tmp: TempDir;

before(() => {
  tmp = tempDir("apx-codex-wt-");
  const root = tmp.path;
  const env: Record<string, string> = { GIT_CONFIG_NOSYSTEM: "1" };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env });
  const main = path.join(root, "main");
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(main, "a.txt"), "a\n");
  git(main, "add", "a.txt");
  git(main, "-c", "user.name=Dev", "-c", "user.email=dev@example.com", "commit", "-q", "-m", "init");
  const worktree = path.join(root, "feature");
  git(main, "worktree", "add", "-q", "-b", "feature", worktree);
  const common = path.join(main, ".git");
  const gitDir = path.join(common, "worktrees", "feature");
  fx = {
    root,
    main,
    worktree,
    common,
    gitDir,
    expected: [gitDir, ...["objects", "refs", "logs"].map((d) => path.join(common, d))],
  };
});
// The SDK's codex may still be exiting when its turn returns; removeDir waits out Windows holding the folder.
after(() => tmp.remove());

/** A `codex` that records its arguments and answers like `codex exec --experimental-json`; `makes` are files its
 * image_gen would leave in its thread's folder under CODEX_HOME. */
function fakeCodex(makes: string[] = []): { bin: string; env: Record<string, string>; args(): string[] } {
  const dir = fs.mkdtempSync(path.join(fx.root, "bin-"));
  const out = path.join(dir, "args.json");
  const events = [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ];
  const fake = fakeProgram(
    dir,
    "codex",
    `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(argv));
const made = require("node:path").join(process.env.CODEX_HOME || "/nonexistent", "generated_images", "thread-1");
for (const f of ${JSON.stringify(makes)}) { fs.mkdirSync(made, { recursive: true }); fs.writeFileSync(made + "/" + f, "x"); }
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join("\n"))} + "\\n"));`,
  );
  return { ...fake, args: () => JSON.parse(fs.readFileSync(out, "utf8")) };
}

/** One Codex turn in `cwd`, as an auto code thread: the agent's autonomy decides whether it writes. */
async function turn(
  cwd: string,
  opts: { autonomy?: string; sessionId?: string; makes?: string[]; shown?: string[] } = {},
): Promise<string[]> {
  const codex = fakeCodex(opts.makes);
  const harness = codexHarness({
    codexPath: async () => codex.bin,
    cwd: () => cwd,
    gate: () => ({ command: { command: "true", args: [], env: {} }, close() {} }),
  });
  const io = {
    thread: { cwd, write: "auto" },
    agent: { autonomy: opts.autonomy ?? "auto" },
    outside: () => false,
    models: ["codex"],
    input: { role: "user", content: "commit it" },
    sessionId: opts.sessionId,
    signal: AbortSignal.timeout(20_000),
    observe() {},
    onText() {},
    showImage: (file: string) => opts.shown?.push(file),
  } as unknown as TurnIO;
  // The harness passes the core's environment on: the stand-in's own needs go there for this turn.
  const saved = process.env.NODE_OPTIONS;
  Object.assign(process.env, codex.env);
  try {
    await harness.run(io);
  } finally {
    if (saved === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = saved;
  }
  return codex.args();
}

const values = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ""] : []));

test("Codex writing in a linked worktree may write its git dir and the shared objects, refs and logs, nothing more", async () => {
  assert.deepEqual(await linkedWorktreeWritableDirs(fx.worktree), fx.expected);
  fs.mkdirSync(path.join(fx.worktree, "src"));
  assert.deepEqual(await linkedWorktreeWritableDirs(path.join(fx.worktree, "src")), fx.expected);
  const args = await turn(fx.worktree);
  assert.deepEqual(values(args, "--sandbox"), ["workspace-write"]);
  assert.deepEqual(values(args, "--add-dir"), fx.expected);
  // Not the shared root (config, packed-refs), its hooks, or the main checkout.
  for (const p of [fx.common, path.join(fx.common, "hooks"), fx.main]) assert.ok(!args.includes(p), `${p} is granted`);
});

test("a resumed Codex turn in a linked worktree gets the same git dirs", async () => {
  const args = await turn(fx.worktree, { sessionId: "thread-1" });
  assert.deepEqual(values(args, "resume"), ["thread-1"]);
  assert.deepEqual(values(args, "--add-dir"), fx.expected);
  assert.deepEqual(values(args, "--sandbox"), ["workspace-write"]);
});

test("Codex gets no git dirs in a main checkout, outside a repo, or when the turn is read-only", async () => {
  assert.deepEqual(await linkedWorktreeWritableDirs(fx.main), []);
  assert.deepEqual(await linkedWorktreeWritableDirs(fx.root), []);
  for (const cwd of [fx.main, fx.root]) {
    const args = await turn(cwd);
    assert.deepEqual(values(args, "--sandbox"), ["workspace-write"]);
    assert.deepEqual(values(args, "--add-dir"), [], cwd);
  }
  const readOnly = await turn(fx.worktree, { autonomy: "manual" });
  assert.deepEqual(values(readOnly, "--sandbox"), ["read-only"]);
  assert.deepEqual(values(readOnly, "--add-dir"), []);
});

test("a GIT_DIR inherited by the core does not decide which git dirs Codex gets", async () => {
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = fx.gitDir;
  try {
    assert.deepEqual(await linkedWorktreeWritableDirs(fx.main), []);
    assert.deepEqual(await linkedWorktreeWritableDirs(fx.worktree), fx.expected);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

test("the images Codex made in this turn show in the chat, not earlier ones or other files", async () => {
  const saved = process.env.CODEX_HOME;
  const home = fs.mkdtempSync(path.join(fx.root, "codex-home-"));
  process.env.CODEX_HOME = home;
  try {
    const dir = path.join(home, "generated_images", "thread-1");
    const shown: string[] = [];
    await turn(fx.root, { makes: ["first.png", "notes.txt"], shown });
    assert.deepEqual(shown, [path.join(dir, "first.png")]);
    shown.length = 0;
    await turn(fx.root, { sessionId: "thread-1", makes: ["second.webp"], shown });
    assert.deepEqual(shown, [path.join(dir, "second.webp")]);
    shown.length = 0;
    await turn(fx.root, { sessionId: "thread-1", shown });
    assert.deepEqual(shown, []);
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved;
  }
});
