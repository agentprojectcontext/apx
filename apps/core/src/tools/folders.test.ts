import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { harnessDir, scratchDir, workDir } from "./folders.ts";
import { commandFolder } from "./shell.ts";

// The owner's message is the call to make: `{"name": "file_read", "args": {...}}`.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (!said.startsWith("{")) return say("ok");
  const { name, args } = JSON.parse(said) as { name: string; args: object };
  return callTool("c1", name, args);
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo: string;
let sibling: string;
before(async () => {
  env = await startCore({ llm });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-folders-")));
  sibling = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-sibling-")));
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(sibling, { recursive: true, force: true });
});

const dirs = (thread: { cwd?: string; project_id?: string }) => [
  workDir(env.core.store, env.home, thread),
  harnessDir(env.core.store, env.home, thread),
];

test("an agent works in its project's folder; an outside agent in APX's side of it, never among other projects", async () => {
  const work = path.join(env.home, "work");
  assert.deepEqual(dirs({}), [work, work]);

  const inRepo = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const side = path.join(env.home, "projects", inRepo);
  assert.deepEqual(dirs({ project_id: inRepo }), [repo, side]);
  assert.deepEqual(dirs({ project_id: inRepo, cwd: repo }), [repo, repo]);

  // A project APX made with no folder elsewhere already is APX's own: both work in it.
  const made = (await env.client.call("projects.create", { name: "Northwind" })).project;
  const own = path.join(env.home, "projects", "northwind");
  assert.deepEqual(dirs({ project_id: made.id }), [own, own]);

  // Its folder off this machine, a project's chat keeps to the project's side, not the folder every chat shares.
  env.core.store.projects.setPresent(inRepo, false);
  assert.deepEqual(dirs({ project_id: inRepo }), [side, side]);
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: inRepo });
  await env.client.call("files.tree", { thread: t.id, dir: "" });
  assert.ok(fs.statSync(side).isDirectory(), "opened in the panel, APX's side is made");
});

test("a path is readable or refused the same way through file_read and shell, written relative or absolute", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "a.txt"), "inside\n");
  fs.writeFileSync(path.join(sibling, "b.txt"), "outside\n");
  fs.symlinkSync(sibling, path.join(repo, "link"));
  const scratch = scratchDir(env.core.store, env.home, t);
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, "s.txt"), "temp\n");
  const out = `../${path.basename(sibling)}`;
  const table: Array<[string, boolean]> = [
    ["src/a.txt", true],
    ["./src/../src/a.txt", true],
    [path.join(repo, "src", "a.txt"), true],
    [path.join(scratch, "s.txt"), true],
    [`${out}/b.txt`, false],
    [path.join(sibling, "b.txt"), false],
    [`src/../${out}/b.txt`, false],
    ["link/b.txt", false],
  ];
  const call = async (name: string, args: object) => {
    await env.client.call("threads.send", { thread: t.id, text: JSON.stringify({ name, args }) });
    await env.settle(t.id);
    return String(llm.calls.at(-1)?.messages.at(-1)?.content);
  };
  for (const [p, readable] of table) {
    const dir = path.dirname(p);
    const verdicts = {
      file_read: await call("file_read", { path: p }),
      cat: await call("shell", { command: `cat ${p}` }),
      "rg in a pipe": await call("shell", { command: `rg -n . ${p} | head -5` }),
      cd: await call("shell", { command: `cd ${dir} && cat ${path.basename(p)}` }),
      "git -C": await call("shell", { command: `git -C ${dir} status --short 2>/dev/null; true` }),
      cwd: await call("shell", { command: `cat ${path.basename(p)}`, cwd: dir }),
    };
    for (const [how, said] of Object.entries(verdicts))
      assert.equal(!/refused:/.test(said), readable, `${how} ${p}: ${said.slice(0, 200)}`);
  }
});

test("ordinary commands name no folder they may not use; ones that leave it through any door are refused", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const thread = { id: "t_paths", project_id: project };
  const verdict = (command: string) => commandFolder(env.core.store, env.home, thread, { command });
  for (const c of [
    "ls -la src | grep a | wc -l",
    "rg -n 'TODO' src/*.ts",
    "find . -name '*.md' -type f 2>/dev/null | head",
    "/usr/bin/env node --version",
    'grep -rn "/api/users" src',
    'echo "see ../elsewhere and /etc for more"',
    "git log --oneline origin/main..HEAD -- src",
    "curl -s https://example.com/a/b.json -o out.json",
    "cat > notes.md <<'EOF'\nread ../elsewhere/x and /etc/hosts\nEOF",
    "ls # ../elsewhere",
    'for f in src/*; do echo "$f"; done',
    `ls ${repo}/src`,
  ])
    assert.ok(!("refused" in verdict(c)), c);
  for (const c of [
    "ls ..",
    "rg foo ../elsewhere",
    "git -C ../elsewhere log",
    "cd .. && ls",
    "(cd ..; ls)",
    "cd; ls",
    "cat --file=../x",
    "FOO=../x env",
    "ls ~/",
    "ls $HOME/work",
    'cat "../a dir/b"',
    "ls ../*",
    "cat /etc/hosts",
    "head -n 1 src/../../x",
  ])
    assert.ok("refused" in verdict(c), c);
});
