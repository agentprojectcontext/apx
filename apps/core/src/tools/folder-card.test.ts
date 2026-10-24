import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, inputOrEnd, pendingInput, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { refusal } from "./folders.ts";
import { commandFolder } from "./shell.ts";

/** A path as a command names it: forward slashes, which Git Bash reads on Windows too. */
const sh = (p: string) => p.split(path.sep).join("/");

// The owner's message is the call to make: `{"name": "shell", "args": {...}}`.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (!said.startsWith("{")) return say("ok");
  const { name, args } = JSON.parse(said) as { name: string; args: object };
  return callTool("c1", name, args);
});

let env: Awaited<ReturnType<typeof startCore>>;
/** ~/work/northwind with the project in app/ and a sibling checkout beside it. */
let northwind: string;
let repo: string;
let project: string;
before(async () => {
  env = await startCore({ llm });
  northwind = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-northwind-")));
  repo = path.join(northwind, "app");
  fs.mkdirSync(path.join(northwind, "docs"), { recursive: true });
  fs.writeFileSync(path.join(northwind, "docs", "plan.md"), "the plan\n");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "readme.md"), "app\n");
  project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.create", { slug: "fausto", name: "Fausto" });
  // Asking before a read outside is manual mode's; auto reads anywhere but APX's home (DECISIONS.md#d-106).
  await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(northwind);
});

const folders = () => env.core.store.projects.get(project)?.read_only_folders;
const lastSeen = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

/** Sends a call in a chat with Fausto; answers the card it raises, if any, with `decision` (and `scope`). */
async function run(
  call: { name: string; args: object },
  o: {
    thread?: string;
    inProject?: boolean;
    decision?: "approve" | "deny";
    scope?: "once" | "project" | "always";
    agent?: string;
  } = {},
) {
  const thread =
    o.thread ??
    (
      await env.client.call("threads.create", {
        kind: "loose",
        agent_id: o.agent ?? "fausto",
        ...(o.inProject === false ? {} : { project_id: project }),
      })
    ).id;
  await env.client.call("threads.send", { thread, text: JSON.stringify(call) });
  const input = await inputOrEnd(env.client, thread);
  if (input && o.decision)
    await env.client.call("runs.respond", {
      input: input.id,
      decision: o.decision,
      ...(o.scope ? { scope: o.scope } : {}),
    });
  await env.settle(thread);
  return { thread, input, said: lastSeen() };
}

const ls = { name: "shell", args: { command: "pwd; ls ../docs" } };

test("manual: a read outside the project's folder asks the owner with a folder card instead of being refused", async () => {
  const { input } = await run(ls, { decision: "deny" });
  assert.ok(input, "a card");
  const docs = path.join(northwind, "docs");
  assert.deepEqual(input.folders, [docs]);
  assert.deepEqual(input.approval_scopes, ["once", "project"]);
  assert.equal(input.prompt, `Fausto quiere leer ${docs}`);
  assert.match(lastSeen(), /not run: the owner declined/);
  assert.equal(folders(), undefined);
});

test("once lets that call read there and keeps nothing; the next read asks again", async () => {
  const { said } = await run(ls, { decision: "approve" });
  assert.match(said, /exit 0[\s\S]*plan\.md/);
  assert.equal(folders(), undefined);
  const again = await run({ name: "file_read", args: { path: "../docs/plan.md" } }, { decision: "approve" });
  assert.deepEqual(again.input?.folders, [path.join(northwind, "docs")], "file_read asks the same way");
  assert.match(again.said, /the plan/);
  assert.equal(folders(), undefined);
});

test("allowing it in the project adds a read-only folder; the call runs and later reads ask nothing", async () => {
  const { thread, said } = await run(ls, { decision: "approve", scope: "project" });
  assert.match(said, /exit 0[\s\S]*plan\.md/);
  assert.deepEqual(folders(), [path.join(northwind, "docs")]);
  const settled = (await env.client.call("threads.get", { thread })).messages.flatMap((m) => m.parts);
  assert.ok(settled.some((p) => p.type === "input" && p.approval_scope === "project"));
  const next = await run({ name: "file_read", args: { path: "../docs/plan.md" } });
  assert.equal(next.input, undefined);
  assert.match(next.said, /the plan/);
  // Read-only: still never changed.
  const write = await run({ name: "shell", args: { command: "touch ../docs/new.md" } });
  assert.match(write.said, /refused: .*read-only folder/);
  await env.client.call("projects.update", { project, read_only_folders: [] });
});

test("total autonomy reads outside without a card and adds nothing", async () => {
  await env.client.call("agents.update", { agent: "fausto", autonomy: "total" });
  try {
    const { input, said } = await run(ls);
    assert.equal(input, undefined);
    assert.match(said, /exit 0[\s\S]*plan\.md/);
    assert.equal(folders(), undefined);
  } finally {
    await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
  }
});

test("total autonomy reads and changes any folder, in a chat with no project too, never APX's own", async () => {
  await env.client.call("agents.update", { agent: "fausto", autonomy: "total" });
  const made = path.join(northwind, "docs", "made.md");
  try {
    for (const inProject of [true, false]) {
      const write = await run(
        { name: "shell", args: { command: `echo hi > ${sh(made)}; cat ${sh(made)}` } },
        { inProject },
      );
      assert.equal(write.input, undefined);
      assert.match(write.said, /exit 0[\s\S]*hi/, `in a project: ${inProject}`);
      fs.rmSync(made);
      const file = await run({ name: "file_write", args: { path: made, content: "from file_write\n" } }, { inProject });
      assert.equal(file.input, undefined);
      assert.equal(fs.readFileSync(made, "utf8"), "from file_write\n", `in a project: ${inProject}`);
      fs.rmSync(made);
      const apx = await run({ name: "file_read", args: { path: path.join(env.home, "apx.db") } }, { inProject });
      assert.match(apx.said, /APX's own folder/);
    }
    assert.equal(folders(), undefined);
    // The owner's read-only folders keep their rule.
    await env.client.call("projects.update", { project, read_only_folders: [path.join(northwind, "docs")] });
    const ro = await run({ name: "shell", args: { command: "touch ../docs/new.md" } });
    assert.match(ro.said, /refused: .*read-only folder/);
  } finally {
    await env.client.call("projects.update", { project, read_only_folders: [] });
    await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
  }
});

test("manual in a chat with no project asks for that call instead of refusing; APX's own folder raises no card", async () => {
  const alone = await run(
    { name: "shell", args: { command: `ls ${sh(northwind)}` } },
    { inProject: false, decision: "approve" },
  );
  assert.deepEqual(alone.input?.folders, [northwind]);
  // No project to keep it in: only this time.
  assert.deepEqual(alone.input?.approval_scopes, ["once"]);
  assert.match(alone.said, /exit 0[\s\S]*docs/);
  const apx = await run({ name: "file_read", args: { path: path.join(env.home, "apx.db") } });
  assert.equal(apx.input, undefined);
  assert.match(apx.said, /APX's own folder/);
});

test("a folder that cannot be kept (a home holding APX's) is offered for this call only", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "fausto", project_id: project }))
    .id;
  const call = { name: "shell", args: { command: `ls ${sh(path.dirname(env.home))}` } };
  await env.client.call("threads.send", { thread, text: JSON.stringify(call) });
  const input = await pendingInput(env.client, thread);
  assert.deepEqual(input?.approval_scopes, ["once"]);
  await assert.rejects(
    env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve", scope: "project" }),
    /not available/,
  );
  await env.client.call("runs.respond", { input: input?.id ?? "", decision: "deny" });
  await env.settle(thread);
  assert.equal(folders(), undefined);
});

test("the folder holding the project is lent for one call, never kept: it would read as the project's own", async () => {
  const { input } = await run({ name: "shell", args: { command: "ls .." } }, { decision: "deny" });
  assert.deepEqual(input?.folders, [northwind]);
  assert.deepEqual(input?.approval_scopes, ["once"]);
  assert.equal(folders(), undefined);
});

test("auto reads another project's file and runs a reading command there with no card", async () => {
  await env.client.call("agents.update", { agent: "fausto", autonomy: "auto" });
  const other = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-acme-")));
  fs.writeFileSync(path.join(other, "brief.md"), "acme brief\n");
  try {
    for (const inProject of [true, false]) {
      const read = await run({ name: "file_read", args: { path: path.join(other, "brief.md") } }, { inProject });
      assert.equal(read.input, undefined, `in a project: ${inProject}`);
      assert.match(read.said, /acme brief/);
      const ls = await run({ name: "shell", args: { command: "ls", cwd: other } }, { inProject });
      assert.equal(ls.input, undefined);
      assert.match(ls.said, /exit 0[\s\S]*brief\.md/);
    }
    // APX's own folder stays closed, and nothing was kept as a read-only folder.
    const apx = await run({ name: "file_read", args: { path: path.join(env.home, "apx.db") } });
    assert.match(apx.said, /APX's own folder/);
    assert.equal(folders(), undefined);
  } finally {
    await removeDir(other);
    await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
  }
});

test("auto asks before writing outside its project; once never keeps the folder", async () => {
  await env.client.call("agents.update", { agent: "fausto", autonomy: "auto" });
  const made = path.join(northwind, "docs", "made.md");
  const write = { name: "file_write", args: { path: made, content: "outside\n" } };
  try {
    const no = await run(write, { decision: "deny" });
    assert.deepEqual(no.input?.folders, [path.join(northwind, "docs")]);
    assert.deepEqual(no.input?.approval_scopes, ["once", "always"]);
    assert.match(no.input?.prompt ?? "", /quiere cambiar archivos en .*fuera de su proyecto/);
    assert.equal(fs.existsSync(made), false);
    const yes = await run(write, { decision: "approve" });
    assert.match(yes.said, /created/);
    assert.equal(fs.readFileSync(made, "utf8"), "outside\n");
    // A command writing there asks the same way; inside the project it runs with no card.
    const cmd = await run({ name: "shell", args: { command: `echo hi > ${sh(made)}` } }, { decision: "deny" });
    assert.deepEqual(cmd.input?.folders, [path.join(northwind, "docs")]);
    const inside = await run({ name: "shell", args: { command: "touch made-inside" } });
    assert.equal(inside.input, undefined);
    assert.ok(fs.existsSync(path.join(repo, "made-inside")));
    assert.equal(folders(), undefined);
  } finally {
    fs.rmSync(made, { force: true });
    await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
  }
});

test("auto changes the owner's other projects and their worktrees with no card, never one in APX's home", async () => {
  await env.client.call("agents.update", { agent: "fausto", autonomy: "auto" });
  const acme = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-acme-")));
  const site = path.join(acme, "site");
  const tree = path.join(acme, "site-fix");
  fs.mkdirSync(site);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=user@example.com", ...args], { cwd: site });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "init");
  git("worktree", "add", "-q", tree);
  const inHome = path.join(env.home, "projects", "inside");
  fs.mkdirSync(inHome, { recursive: true });
  try {
    await env.client.call("projects.register", { path: site, init: true });
    await env.client.call("projects.register", { path: inHome, init: true });
    const write = await run({ name: "file_write", args: { path: path.join(site, "notes.md"), content: "x\n" } });
    assert.equal(write.input, undefined, write.said);
    assert.equal(fs.readFileSync(path.join(site, "notes.md"), "utf8"), "x\n");
    const cmd = await run({ name: "shell", args: { command: "touch fixed.txt", cwd: tree } });
    assert.equal(cmd.input, undefined, cmd.said);
    assert.ok(fs.existsSync(path.join(tree, "fixed.txt")));
    const apx = await run({ name: "file_write", args: { path: path.join(inHome, "x.md"), content: "x" } });
    assert.match(apx.said, /APX's own folder/);
    assert.equal(fs.existsSync(path.join(inHome, "x.md")), false);
  } finally {
    await removeDir(acme);
    await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
  }
});

test("always for this agent lets it change that folder from then on, and no other agent", async () => {
  await env.client.call("agents.create", { slug: "kevin", name: "Kevin" });
  for (const agent of ["fausto", "kevin"]) await env.client.call("agents.update", { agent, autonomy: "auto" });
  const docs = path.join(northwind, "docs");
  const write = (file: string) => ({ name: "file_write", args: { path: path.join(docs, file), content: "y\n" } });
  try {
    const first = await run(write("a.md"), { decision: "approve", scope: "always" });
    assert.deepEqual(first.input?.folders, [docs]);
    assert.match(first.said, /created/);
    fs.mkdirSync(path.join(docs, "deep"));
    const later = await run(write(path.join("deep", "b.md")));
    assert.equal(later.input, undefined, later.said);
    assert.equal(fs.readFileSync(path.join(docs, "deep", "b.md"), "utf8"), "y\n");
    const other = await run(write("c.md"), { agent: "kevin", decision: "deny" });
    assert.deepEqual(other.input?.folders, [docs]);
    assert.equal(fs.existsSync(path.join(docs, "c.md")), false);
    const grant = env.core.store.approvals.list().find((g) => g.tool === "write_folder");
    assert.equal(grant?.condition, docs, "the owner sees which folder in the agent's permissions");
  } finally {
    for (const g of env.core.store.approvals.list()) env.core.store.approvals.revoke(g.key, undefined, g.agent_id);
    fs.rmSync(path.join(docs, "a.md"), { force: true });
    await removeDir(path.join(docs, "deep"));
    for (const agent of ["fausto", "kevin"]) await env.client.call("agents.update", { agent, autonomy: "manual" });
  }
});

test("plan reads anywhere and changes nothing, with no card", async () => {
  await env.client.call("agents.update", { agent: "fausto", autonomy: "plan" });
  try {
    const read = await run({ name: "file_read", args: { path: path.join(northwind, "docs", "plan.md") } });
    assert.equal(read.input, undefined);
    assert.match(read.said, /the plan/);
    const write = await run({ name: "file_write", args: { path: "notes.md", content: "x" } });
    assert.equal(write.input, undefined);
    assert.match(write.said, /not run: .*plan mode.*proposal in your answer/);
    assert.equal(fs.existsSync(path.join(repo, "notes.md")), false);
  } finally {
    await env.client.call("agents.update", { agent: "fausto", autonomy: "manual" });
  }
});

test("a refusal never sends the agent to ask_owner for a folder", () => {
  assert.doesNotMatch(refusal.outside("x"), /ask_owner/);
  assert.doesNotMatch(refusal.alone("x"), /ask_owner/);
  assert.match(refusal.readOnly("x"), /can be read, never changed/);
});

test("a worktree inside the project is made through the folder rule; one outside it is refused", () => {
  const thread = { id: "t_wt", project_id: project, reach: "card" as const };
  const verdict = (command: string) => commandFolder(env.core.store, env.home, thread, { command });
  for (const c of ["git worktree add .worktrees/x -b fix/x", "git worktree add -b fix/x .worktrees/x origin/release"])
    assert.ok(!("refused" in verdict(c)), c);
  for (const c of ["git worktree add ../x -b fix/x", "git worktree add /tmp/../elsewhere/x"]) {
    const r = verdict(c);
    assert.ok("refused" in r && /outside the folders you can change/.test(r.refused), `${c}: ${JSON.stringify(r)}`);
  }
});
