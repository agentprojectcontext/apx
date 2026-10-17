import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { PendingInput } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { refusal } from "./folders.ts";
import { commandFolder } from "./shell.ts";

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
  northwind = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-northwind-")));
  repo = path.join(northwind, "app");
  fs.mkdirSync(path.join(northwind, "docs"), { recursive: true });
  fs.writeFileSync(path.join(northwind, "docs", "plan.md"), "the plan\n");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "readme.md"), "app\n");
  project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.create", { slug: "fausto", name: "Fausto" });
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(northwind, { recursive: true, force: true });
});

const folders = () => env.core.store.projects.get(project)?.read_only_folders;
const lastSeen = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

/** Sends a call in a chat with Fausto; answers the card it raises, if any, with `decision` (and `scope`). */
async function run(
  call: { name: string; args: object },
  o: { thread?: string; inProject?: boolean; decision?: "approve" | "deny"; scope?: "once" | "project" } = {},
) {
  const thread =
    o.thread ??
    (
      await env.client.call("threads.create", {
        kind: "loose",
        agent_id: "fausto",
        ...(o.inProject === false ? {} : { project_id: project }),
      })
    ).id;
  await env.client.call("threads.send", { thread, text: JSON.stringify(call) });
  let input: PendingInput | undefined;
  for (let i = 0; i < 60 && !input; i++) {
    input = (await env.client.call("runs.pending", { thread })).inputs[0];
    const busy = (await env.client.call("threads.get", { thread })).runs.some((r) => !r.ended_at);
    if (!input && !busy && i > 2) break;
    if (!input) await new Promise((r) => setTimeout(r, 25));
  }
  if (input && o.decision)
    await env.client.call("runs.respond", {
      input: input.id,
      decision: o.decision,
      ...(o.scope ? { scope: o.scope } : {}),
    });
  await env.settle(thread);
  return { thread, input, said: lastSeen() };
}

const ls = { name: "shell", args: { command: "pwd; ls .." } };

test("a read outside the project's folder asks the owner with a folder card instead of being refused", async () => {
  const { input } = await run(ls, { decision: "deny" });
  assert.ok(input, "a card");
  assert.deepEqual(input.folders, [northwind]);
  assert.deepEqual(input.approval_scopes, ["once", "project"]);
  assert.equal(input.prompt, `Fausto quiere leer ${northwind}`);
  assert.match(lastSeen(), /not run: the owner declined/);
  assert.equal(folders(), undefined);
});

test("once lets that call read there and keeps nothing; the next read asks again", async () => {
  const { said } = await run(ls, { decision: "approve" });
  assert.match(said, /exit 0[\s\S]*docs/);
  assert.equal(folders(), undefined);
  const again = await run({ name: "file_read", args: { path: "../docs/plan.md" } }, { decision: "approve" });
  assert.deepEqual(again.input?.folders, [path.join(northwind, "docs")], "file_read asks the same way");
  assert.match(again.said, /the plan/);
  assert.equal(folders(), undefined);
});

test("allowing it in the project adds a read-only folder; the call runs and later reads ask nothing", async () => {
  const { thread, said } = await run(ls, { decision: "approve", scope: "project" });
  assert.match(said, /exit 0[\s\S]*docs/);
  assert.deepEqual(folders(), [northwind]);
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
    assert.match(said, /exit 0[\s\S]*docs/);
    assert.equal(folders(), undefined);
  } finally {
    await env.client.call("agents.update", { agent: "fausto", autonomy: "standard" });
  }
});

test("a chat with no project, and APX's own folder, keep the refusal and raise no card", async () => {
  const alone = await run({ name: "shell", args: { command: `ls ${northwind}` } }, { inProject: false });
  assert.equal(alone.input, undefined);
  assert.match(alone.said, /refused: .*outside the folders you can read: the folder you work in and your temp folder/);
  const apx = await run({ name: "file_read", args: { path: path.join(env.home, "apx.db") } });
  assert.equal(apx.input, undefined);
  assert.match(apx.said, /APX's own folder/);
});

test("a folder that cannot be kept (a home holding APX's) is offered for this call only", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "fausto", project_id: project }))
    .id;
  const call = { name: "shell", args: { command: `ls ${path.dirname(env.home)}` } };
  await env.client.call("threads.send", { thread, text: JSON.stringify(call) });
  let input: PendingInput | undefined;
  for (let i = 0; i < 100 && !input; i++) {
    input = (await env.client.call("runs.pending", { thread })).inputs[0];
    if (!input) await new Promise((r) => setTimeout(r, 25));
  }
  assert.deepEqual(input?.approval_scopes, ["once"]);
  await assert.rejects(
    env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve", scope: "project" }),
    /not available/,
  );
  await env.client.call("runs.respond", { input: input?.id ?? "", decision: "deny" });
  await env.settle(thread);
  assert.equal(folders(), undefined);
});

test("a refusal never sends the agent to ask_owner for a folder", () => {
  assert.doesNotMatch(refusal.outside("x"), /ask_owner/);
  assert.doesNotMatch(refusal.alone("x"), /ask_owner/);
  assert.match(refusal.readOnly("x"), /can be read, never changed/);
});

test("a worktree inside the project is made through the folder rule; one outside it is refused", () => {
  const thread = { id: "t_wt", project_id: project };
  const verdict = (command: string) => commandFolder(env.core.store, env.home, thread, { command });
  for (const c of [
    "git worktree add .claude/worktrees/x -b fix/x",
    "git worktree add -b fix/x .claude/worktrees/x origin/release",
  ])
    assert.ok(!("refused" in verdict(c)), c);
  for (const c of ["git worktree add ../x -b fix/x", "git worktree add /tmp/../elsewhere/x"]) {
    const r = verdict(c);
    assert.ok("refused" in r && /outside the folders you can change/.test(r.refused), `${c}: ${JSON.stringify(r)}`);
  }
});
