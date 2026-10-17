import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { harnessDir, judge, refusal, rootsOf, scratchDir, workDir } from "./folders.ts";
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

  // Refused, both say the same next step, naming the tool that asks the owner.
  const p = `${out}/b.txt`;
  assert.equal(await call("file_read", { path: p }), `refused: ${refusal.outside(p)}`);
  assert.ok((await call("shell", { command: `rg -n x ${p}` })).endsWith(`refused: ${refusal.outside(p)}`));
  assert.match(refusal.outside(p), /ask_owner/);
  const { tools } = await env.client.call("agents.tools", {});
  assert.ok(tools.some((tool) => tool.name === "ask_owner"));
  assert.match(await call("file_write", { path: p, content: "x" }), /outside the folders you can change: write in/);
});

test("a read-only folder is read, never changed", () => {
  const roots = [
    { dir: repo, write: true, scratch: false },
    { dir: sibling, write: false, scratch: false },
  ];
  const file = path.join(sibling, "b.txt");
  assert.deepEqual(judge(roots, file, repo), { at: file, base: sibling, scratch: false, write: false });
  assert.deepEqual(judge(roots, file, repo, true), { refused: refusal.readOnly(file) });
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

test("a project's read-only folders are read by file_read and shell, never changed, until the owner removes them", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  const ref = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ref-")));
  const away = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-away-")));
  fs.writeFileSync(path.join(ref, "v1.txt"), "old\n");
  fs.writeFileSync(path.join(away, "x.txt"), "away\n");
  fs.symlinkSync(away, path.join(ref, "out"));
  const call = async (name: string, args: object) => {
    await env.client.call("threads.send", { thread: t.id, text: JSON.stringify({ name, args }) });
    await env.settle(t.id);
    return String(llm.calls.at(-1)?.messages.at(-1)?.content);
  };
  const file = path.join(ref, "v1.txt");
  try {
    const set = await env.client.call("projects.update", { project, read_only_folders: [ref, `${ref}/`] });
    assert.deepEqual(set.project.read_only_folders, [ref], "kept once, as written");

    assert.match(await call("file_read", { path: file }), /old/);
    assert.match(await call("shell", { command: `rg -n old ${ref}` }), /v1\.txt/);
    assert.match(await call("shell", { command: `cat v1.txt`, cwd: ref }), /old/);
    // The turn says where they are; a delegated sub-chat of the project reads them too.
    assert.match(
      JSON.stringify(llm.calls.at(-1)?.messages),
      /Read-only folders \(read with file tools or shell, never change\): /,
    );
    const sub = { id: "t_sub", parent_id: t.id, project_id: project };
    assert.deepEqual(rootsOf(env.core.store, env.home, sub).at(-1), { dir: ref, write: false, scratch: false });

    assert.equal(await call("file_write", { path: file, content: "x" }), `refused: ${refusal.readOnly(file)}`);
    assert.equal(await call("file_edit", { path: file, old: "old", new: "x" }), `refused: ${refusal.readOnly(file)}`);
    assert.match(await call("shell", { command: `touch ${ref}/new.txt` }), /refused: .*read-only folder/);
    assert.match(await call("shell", { command: "touch new.txt", cwd: ref }), /refused: .*read-only folder/);
    assert.equal(fs.readFileSync(file, "utf8"), "old\n");
    assert.ok(!fs.existsSync(path.join(ref, "new.txt")));
    // A link inside it does not reach past it.
    const linked = path.join(ref, "out", "x.txt");
    assert.equal(await call("file_read", { path: linked }), `refused: ${refusal.outside(linked)}`);
    assert.match(await call("shell", { command: `cat ${linked}` }), /refused: .*outside the folders you can read/);

    await env.client.call("projects.update", { project, read_only_folders: [] });
    assert.equal(env.core.store.projects.get(project)?.read_only_folders, undefined);
    assert.equal(await call("file_read", { path: file }), `refused: ${refusal.outside(file)}`);
  } finally {
    await env.client.call("projects.update", { project, read_only_folders: [] });
    fs.rmSync(ref, { recursive: true, force: true });
    fs.rmSync(away, { recursive: true, force: true });
  }
});

test("a read-only folder must be an absolute folder on disk, apart from APX's home and the project's own folder", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  const refused = async (folder: string, why: RegExp) =>
    assert.rejects(env.client.call("projects.update", { project, read_only_folders: [folder] }), why);
  await refused("relative/dir", /not an absolute path/);
  await refused(path.join(sibling, "missing"), /not a folder here/);
  await refused(path.join(sibling, "b.txt"), /not a folder here/);
  await refused(env.home, /APX's own folder/);
  fs.mkdirSync(path.join(env.home, "projects"), { recursive: true });
  await refused(path.join(env.home, "projects"), /APX's own folder/);
  await refused(path.dirname(env.home), /APX's own folder/);
  await refused(repo, /already in the project's folder/);
  await refused(path.join(repo, "docs"), /already in the project's folder/);
  assert.equal(env.core.store.projects.get(project)?.read_only_folders, undefined, "nothing kept from a refusal");
  // A parent of the project's folder is fine: the project's folder still comes first and stays writable.
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-outer-")));
  try {
    const inner = path.join(outer, "app");
    const nested = (await env.client.call("projects.create", { path: inner })).project.id;
    await env.client.call("projects.update", { project: nested, read_only_folders: [outer] });
    const roots = rootsOf(env.core.store, env.home, { id: "t_p", project_id: nested });
    assert.deepEqual(judge(roots, "a.txt", inner, true), {
      at: path.join(inner, "a.txt"),
      base: inner,
      scratch: false,
      write: true,
    });
    const b = path.join(outer, "b.txt");
    assert.deepEqual(judge(roots, b, inner, true), { refused: refusal.readOnly(b) });
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});
