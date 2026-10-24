import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import {
  artifactSources,
  folderAccess,
  harnessDir,
  judge,
  namesApxHome,
  refusal,
  rootsOf,
  scratchDir,
  scratchRoot,
  tempAreas,
  workDir,
} from "./folders.ts";
import { commandFolder } from "./shell.ts";

/** A path as a command names it: forward slashes, which Git Bash reads on Windows too. */
const sh = (p: string) => p.split(path.sep).join("/");

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
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-folders-")));
  sibling = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-sibling-")));
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
  await removeDir(sibling);
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
  const t = {
    ...(await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: inRepo })),
    reach: "card" as const,
  };
  await env.client.call("files.tree", { thread: t.id, dir: "" });
  assert.ok(fs.statSync(side).isDirectory(), "opened in the panel, APX's side is made");
});

test("a path is readable or refused the same way through file_read and shell, written relative or absolute", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  const t = {
    ...(await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project })),
    reach: "card" as const,
  };
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
  const store = env.core.store;
  for (const [p, readable] of table) {
    const dir = path.dirname(p);
    const forms: Array<[string, { command: string; cwd?: string }]> = [
      ["cat", { command: `cat ${sh(p)}` }],
      ["rg in a pipe", { command: `rg -n . ${sh(p)} | head -5` }],
      ["cd", { command: `cd ${sh(dir)} && cat ${path.basename(p)}` }],
      ["git -C", { command: `git -C ${sh(dir)} status --short 2>/dev/null; true` }],
      ["cwd", { command: `cat ${path.basename(p)}`, cwd: dir }],
    ];
    // Judged alone, every form gives the same verdict, and a read outside offers the same folder to the owner.
    const judged: Array<[string, ReturnType<typeof folderAccess>]> = [
      ["file_read", folderAccess(store, env.home, t, p)],
      ...forms.map(
        ([how, a]) => [how, commandFolder(store, env.home, t, a)] as [string, ReturnType<typeof folderAccess>],
      ),
    ];
    for (const [how, r] of judged) {
      assert.equal(!("refused" in r), readable, `${how} ${p}: ${JSON.stringify(r)}`);
      if ("refused" in r) assert.equal(r.offer, sibling, `${how} ${p} offers the folder holding it`);
    }
    // Through the agent on total autonomy, a read outside runs with every folder open (DECISIONS.md#d-102).
    assert.doesNotMatch(await call("file_read", { path: p }), /refused:/, `file_read ${p}`);
    for (const [how, a] of forms) assert.doesNotMatch(await call("shell", a), /refused:/, `${how} ${p}`);
  }
  assert.equal(store.projects.get(project)?.read_only_folders, undefined, "a loan keeps nothing");

  // Refused, no tool tells the agent to go asking for a folder: the owner's card is how it happens.
  const p = `${out}/b.txt`;
  assert.deepEqual(folderAccess(store, env.home, t, p), { refused: refusal.outside(p), offer: sibling });
  assert.doesNotMatch(refusal.outside(p), /ask_owner/);
  // On total autonomy it writes there too.
  assert.match(await call("file_write", { path: p, content: "x" }), /^replaced /);
  assert.equal(fs.readFileSync(path.join(sibling, "b.txt"), "utf8"), "x");
});

test("a read-only folder is read, never changed", () => {
  const roots = [
    { dir: repo, write: true, scratch: false },
    { dir: sibling, write: false, scratch: false },
  ];
  const file = path.join(sibling, "b.txt");
  assert.deepEqual(judge(roots, file, repo), { at: file, base: sibling, scratch: false, write: false });
  assert.deepEqual(judge(roots, file, repo, { write: true }), { refused: refusal.readOnly(file) });
});

test("ordinary commands name no folder they may not use; ones that leave it through any door are refused", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const thread = { id: "t_paths", project_id: project, reach: "card" as const };
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
    `ls ${sh(repo)}/src`,
    "cat /etc/hosts",
    "cd $(git rev-parse --show-toplevel) && ls",
    "cd `git rev-parse --show-toplevel` && ls",
    `rg "${sh(sibling)}/" src`,
    `grep -rn "${sh(sibling)}" src`,
    "ls src >&2 2>/dev/null",
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
    "head -n 1 src/../../x",
    "cp x /usr/local/bin/y",
    "cat ~root/.ssh/id_rsa",
  ])
    assert.ok("refused" in verdict(c), c);
});

test("a project's read-only folders are read by file_read and shell, never changed, until the owner removes them", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  const t = {
    ...(await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project })),
    reach: "card" as const,
  };
  const ref = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ref-")));
  const away = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-away-")));
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
    assert.match(await call("shell", { command: `grep -rn old ${sh(ref)}` }), /v1\.txt/);
    assert.match(await call("shell", { command: `cat v1.txt`, cwd: ref }), /old/);
    // The turn says where they are, beside the folder it works in; a delegated sub-chat of the project reads them too.
    const said = JSON.stringify(llm.calls.at(-1)?.messages);
    assert.match(said, /Read-only folders \(read with file tools or shell, never change\): /);
    assert.match(said, /Folder you work in \(yours to change\): /);
    const sub = { id: "t_sub", parent_id: t.id, project_id: project, reach: "card" as const };
    assert.deepEqual(
      rootsOf(env.core.store, env.home, sub).find((r) => !r.write),
      { dir: ref, write: false, scratch: false },
    );

    assert.equal(await call("file_write", { path: file, content: "x" }), `refused: ${refusal.readOnly(file)}`);
    assert.equal(await call("file_edit", { path: file, old: "old", new: "x" }), `refused: ${refusal.readOnly(file)}`);
    assert.match(await call("shell", { command: `touch ${sh(ref)}/new.txt` }), /refused: .*read-only folder/);
    assert.match(await call("shell", { command: "touch new.txt", cwd: ref }), /refused: .*read-only folder/);
    assert.equal(fs.readFileSync(file, "utf8"), "old\n");
    assert.ok(!fs.existsSync(path.join(ref, "new.txt")));
    // A link inside it does not reach past it: what it points at is outside, offered on its own.
    const linked = path.join(ref, "out", "x.txt");
    assert.deepEqual(folderAccess(env.core.store, env.home, t, linked), {
      refused: refusal.outside(linked),
      offer: away,
    });
    // On total autonomy that read runs lent for the call, and the project keeps only what the owner gave it.
    assert.match(await call("shell", { command: `cat ${sh(linked)}` }), /away/);
    assert.deepEqual(env.core.store.projects.get(project)?.read_only_folders, [ref]);

    await env.client.call("projects.update", { project, read_only_folders: [] });
    assert.equal(env.core.store.projects.get(project)?.read_only_folders, undefined);
    assert.deepEqual(folderAccess(env.core.store, env.home, t, file), { refused: refusal.outside(file), offer: ref });
  } finally {
    await env.client.call("projects.update", { project, read_only_folders: [] });
    await removeDir(ref);
    await removeDir(away);
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
  // Nor the system's temp folders, where every chat keeps its own.
  await refused(path.dirname(scratchRoot(env.home)), /APX's own folder|temp folders/);
  await refused("/", /APX's own folder|temp folders/);
  await refused(repo, /already in the project's folder/);
  await refused(path.join(repo, "docs"), /already in the project's folder/);
  assert.equal(env.core.store.projects.get(project)?.read_only_folders, undefined, "nothing kept from a refusal");
  // Nor a folder holding the project's: listed as read-only, it reads as if the agent's own folder could not change.
  const outer = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-outer-")));
  try {
    const nested = (await env.client.call("projects.create", { path: path.join(outer, "app") })).project.id;
    await assert.rejects(
      env.client.call("projects.update", { project: nested, read_only_folders: [outer] }),
      /holds the project's folder/,
    );
  } finally {
    await removeDir(outer);
  }
});

test("in a project with a read-only folder, commands read it freely and only writes into it are refused", async () => {
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const ref = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ro-")));
  fs.mkdirSync(path.join(ref, "sub"));
  fs.writeFileSync(path.join(ref, "f"), "old\n");
  fs.writeFileSync(path.join(ref, "script.mjs"), "console.log(1)\n");
  fs.symlinkSync(path.join(ref, "sub"), path.join(repo, "l"));
  const thread = { id: "t_ro", project_id: project, reach: "card" as const };
  const verdict = (command: string, cwd?: string) =>
    commandFolder(env.core.store, env.home, thread, { command, ...(cwd ? { cwd } : {}) });
  const RO = ref;
  const rel = `../${path.basename(ref)}`;
  try {
    await env.client.call("projects.update", { project, read_only_folders: [ref] });
    for (const c of [
      `cp ${sh(RO)}/f ./f`,
      `cp -r ${sh(RO)}/sub ./copy`,
      `rsync -a ${sh(RO)}/ ./mirror/`,
      `cat ${sh(RO)}/f > out.txt`,
      `cd ${sh(RO)} && ls`,
      `cd ${sh(RO)}`,
      `ls ${sh(RO)} 2>/dev/null`,
      `cat ${sh(RO)}/f | jq .`,
      `cat ${sh(RO)}/f | sort`,
      `sed -n 1,5p ${sh(RO)}/f`,
      `diff ${sh(RO)}/f ./f`,
      `git -C ${sh(RO)} diff HEAD~1`,
      `git -C ${sh(RO)} log`,
      `rg foo ${sh(RO)}`,
      `node ${sh(RO)}/script.mjs`,
      `cat ${rel}/f >&2`,
      `cd ${sh(RO)} && git log --oneline | head > ${sh(repo)}/log.txt`,
      `cd ${sh(RO)} && cat f > /dev/null`,
      "cd $(git rev-parse --show-toplevel) && ls",
    ])
      assert.ok(!("refused" in verdict(c)), c);
    assert.ok(!("refused" in verdict("ls -la", RO)), "a read in it as the cwd");
    const refusedRO = [
      `touch ${sh(RO)}/x`,
      `touch ${rel}/x`,
      `cp a ${sh(RO)}/x`,
      `mv ${sh(RO)}/f ./f`,
      `echo x > ${sh(RO)}/o`,
      `echo x >> ${rel}/o`,
      `sed -i s/a/b/ ${sh(RO)}/f`,
      `sed -i.bak -e s/a/b/ ${sh(RO)}/f`,
      `cat f | tee -a ${sh(RO)}/log`,
      `cd ${sh(RO)} && touch x`,
      `cd ${sh(RO)} && npm install`,
      `cd ${sh(RO)} && git reset HEAD`,
      `git -C ${sh(RO)} commit -m x`,
      `git -C ${sh(RO)} checkout main`,
      `rm ${sh(RO)}/f`,
      `mkdir ${sh(RO)}/d`,
      `chmod +x ${sh(RO)}/f`,
      `find ${sh(RO)} -name '*.tmp' -delete`,
      `find ${sh(RO)} -exec rm {} +`,
      `rsync -a ./x ${sh(RO)}/`,
      `ln -s x ${sh(RO)}/l`,
      `sh -c "touch ${sh(RO)}/x"`,
      "touch l/../x",
      `touch ~+/${rel}/x`,
      `touch $PWD/${rel}/a`,
      `curl -s https://example.com -o ${sh(RO)}/page.html`,
    ];
    for (const c of refusedRO) {
      const r = verdict(c);
      assert.ok("refused" in r && /read-only folder/.test(r.refused), `${c}: ${JSON.stringify(r)}`);
    }
    for (const [c, cwd] of [
      ["touch new.txt", RO],
      ["npm install", RO],
    ] as const) {
      const r = verdict(c, cwd);
      assert.ok("refused" in r && /read-only folder/.test(r.refused), `${c} in ${cwd}: ${JSON.stringify(r)}`);
    }
    // Words whose place is only known when the shell runs cannot write while there is a read-only folder to protect.
    for (const c of [
      `touch {${sh(RO)}/x,y}`,
      "cp a ~-/x",
      "touch $OLDPWD/x",
      `touch \`echo ${RO}\`/x`,
      `touch $(echo ${sh(RO)})/x`,
      "cd $X && touch y",
      "echo hi > $OUT",
      `find ${sh(RO)} | xargs rm`,
    ]) {
      const r = verdict(c);
      assert.ok("refused" in r && /cannot tell where/.test(r.refused), `${c}: ${JSON.stringify(r)}`);
    }
    assert.deepEqual(verdict(`touch ${sh(RO)}/x`), { refused: refusal.readOnly(`${sh(RO)}/x`) });
    assert.doesNotMatch(refusal.readOnly("x"), /write your changes in the folder you work in/);
  } finally {
    await env.client.call("projects.update", { project, read_only_folders: [] });
    fs.unlinkSync(path.join(repo, "l"));
    await removeDir(ref);
  }
  // Without a read-only folder there is nothing to protect: the owner is asked as before (commandRisk), not refused.
  for (const c of ["echo hi > $OUT", "touch {a,b}", "cd $X && touch y"]) assert.ok(!("refused" in verdict(c)), c);
});

test("system temp folders are scratch space, except APX's own chats' temp folders", () => {
  // A home on no temp folder, like the owner's (never created: only compared against).
  const home = path.join(path.parse(os.tmpdir()).root, "apx-home-nowhere");
  const areas = tempAreas(home);
  assert.ok(areas.length > 0);
  const own = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-own-")));
  const roots = [
    { dir: own, write: true, scratch: false },
    { dir: scratchRoot(home), write: false, scratch: true, off: true },
    ...areas.map((dir) => ({ dir, write: true, scratch: true })),
  ];
  try {
    // /tmp is a temp folder on Unix only (on Windows it is a folder of whichever drive the path lands on).
    for (const p of [
      ...(process.platform === "win32" ? [] : ["/tmp/out.txt"]),
      path.join(os.tmpdir(), "build", "a.js"),
    ])
      assert.equal("refused" in judge(roots, p, own, { write: true }), false, p);
    const other = path.join(scratchRoot(home), "t_other", "a.txt");
    assert.equal("refused" in judge(roots, other, own), true, "another chat's temp folder");
    // A temp folder that holds APX's home (a throwaway core's) is not shared scratch.
    assert.equal(tempAreas(path.join(os.tmpdir(), "apx-x")).includes(os.tmpdir()), false);
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
  }
});

test("a refusal outside every folder names a next step that exists", async () => {
  const r = commandFolder(
    env.core.store,
    env.home,
    { id: "t_loose", reach: "card" as const },
    { command: `cat ${sh(sibling)}/b.txt` },
  );
  assert.ok("refused" in r && !/ask_owner/.test(r.refused), JSON.stringify(r));
  assert.match(r.refused, /outside the folders you can read/);
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const apx = path.join(env.home, "apx.db");
  const roots = rootsOf(env.core.store, env.home, { id: "t_x", project_id: project, reach: "card" as const });
  assert.deepEqual(judge(roots, apx, repo, { home: env.home, project: true }), { refused: refusal.apx(apx) });
});

test("a linked git worktree of the project beside its folder is the project's, unless the thread keeps to one", async (t) => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
  const base = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-wt-")));
  t.after(() => removeDir(base));
  const main = path.join(base, "northwind");
  const beside = path.join(base, "northwind-issue-7");
  fs.mkdirSync(main);
  git(main, "init", "-q");
  git(main, "-c", "user.name=Acme", "-c", "user.email=user@example.com", "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-q", beside);
  const project = (await env.client.call("projects.register", { path: main, init: true })).project.id;
  const file = path.join(beside, "a.txt");
  const roots = rootsOf(env.core.store, env.home, { id: "t_wt", project_id: project, reach: "card" as const });
  const r = judge(roots, file, main, { write: true, home: env.home, project: true });
  assert.ok(!("refused" in r) && r.write, JSON.stringify(r));
  const kept = rootsOf(env.core.store, env.home, {
    id: "t_wt2",
    project_id: project,
    cwd: main,
    reach: "card" as const,
  });
  assert.ok("refused" in judge(kept, file, main, { write: true, home: env.home, project: true }));
});

test("an agent builds in its project's artifact sources, never in an artifact's memory or another project's sources", () => {
  const store = env.core.store;
  const t = { id: "thr_sources", project_id: "p_acme", reach: "fenced" as const };
  const src = path.join(artifactSources(env.home, "p_acme"), "expenses", "src", "main.jsx");
  const written = folderAccess(store, env.home, t, src, { write: true });
  assert.ok(!("refused" in written), JSON.stringify(written));
  const memory = path.join(env.home, "artifacts", "p_acme", "expenses", "data.sqlite");
  assert.ok("refused" in folderAccess(store, env.home, t, memory, { write: true }));
  const other = path.join(artifactSources(env.home, "p_other"), "expenses", "src", "main.jsx");
  assert.ok("refused" in folderAccess(store, env.home, t, other, { write: true }));
  // The shell's own text rule: this project's sources pass, the rest of APX's home does not.
  const dir = sh(path.dirname(src));
  assert.equal(namesApxHome(`cd ${dir} && npm run build`, sh(env.home), "p_acme"), false);
  assert.equal(namesApxHome(`cd ${dir} && cat ${sh(env.home)}/apx.db`, sh(env.home), "p_acme"), true);
  assert.equal(namesApxHome(`ls ${sh(artifactSources(env.home, "p_other"))}`, sh(env.home), "p_acme"), true);
});

test("APX's home counts however a command spells it: through a link, in another case on Windows, as .apx\\v2", () => {
  const base = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-home-names-")));
  const home = path.join(base, "home");
  fs.mkdirSync(path.join(home, "artifact-sources", "p_acme"), { recursive: true });
  const alias = path.join(base, "alias");
  fs.symlinkSync(home, alias, process.platform === "win32" ? "junction" : "dir");
  try {
    // The same folder by another name: a link (on Windows also its short 8.3 name, which resolves the same way).
    assert.equal(namesApxHome(`cat ${sh(alias)}/apx.db`, home, "p_acme"), true);
    assert.equal(namesApxHome(`cat ${sh(home)}/apx.db`, alias, "p_acme"), true);
    assert.equal(namesApxHome(`cd ${sh(alias)}/artifact-sources/p_acme && npm run build`, home, "p_acme"), false);
    assert.equal(namesApxHome("type %USERPROFILE%\\.apx\\v2\\apx.db", home, "p_acme"), true);
    assert.equal(namesApxHome(`cat ${sh(base)}/elsewhere.txt`, home, "p_acme"), false);
    if (process.platform === "win32")
      assert.equal(namesApxHome(`type ${home.toUpperCase()}\\apx.db`, home, "p_acme"), true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
