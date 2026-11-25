import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { realpath } from "../paths.ts";
import { tempDir } from "../testkit/platform.ts";
import { workspaceOf } from "./delegation.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Asked to "work in <folder>", the chat's agent hands it to a worker of its own in that folder.
const llm = scriptedLlm((_req, { said, afterTool }) => {
  const folder = /^work in (.+)$/.exec(said)?.[1];
  if (folder && !afterTool)
    return callTool("d1", "delegate", {
      worker: { name: "Fixer", instructions: "Fix it." },
      project: folder,
      task: "Fix.",
    });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tmp: ReturnType<typeof tempDir>;
let own: string;
let other: string;
let tree: string;
let loose: string;
let ownId: string;
let otherId: string;
before(async () => {
  env = await startCore({ llm });
  tmp = tempDir("apx-deleg-folder-");
  const base = realpath(tmp.path);
  [own, other, tree, loose] = ["own", "northwind", "northwind-fix", "loose"].map((n) => path.join(base, n)) as [
    string,
    string,
    string,
    string,
  ];
  for (const d of [own, other, loose]) fs.mkdirSync(d);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=user@example.com", ...args], { cwd: other });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "init");
  git("worktree", "add", "-q", tree);
  ownId = (await env.client.call("projects.register", { path: own, init: true })).project.id;
  otherId = (await env.client.call("projects.register", { path: other, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await tmp[Symbol.asyncDispose]();
});

const agent = (autonomy: "auto" | "total") => {
  const a = env.core.store.agents.get("superagent");
  assert.ok(a);
  return { ...a, autonomy };
};

test("working for the owner, a session's folder may be in another of the owner's projects or its worktrees, and says where", async () => {
  const store = env.core.store;
  const chat = store.threads.create({ kind: "loose", title: "Chat", agent_ids: ["superagent"], project_id: ownId });
  const ask = (folder: string, home: string | undefined = env.home, by = agent("auto")) =>
    workspaceOf(store, by, by, chat, ownId, { folder }, home);
  const name = store.projects.get(otherId)?.name;
  for (const folder of [other, tree]) {
    const r = ask(folder);
    assert.ok(typeof r === "object", String(r));
    assert.equal(r.cwd, realpath(folder));
    assert.equal(r.where, `project ${name}`);
  }
  // A folder that is no project stays refused, unless every agent in the chain acts anywhere on its own.
  assert.match(String(ask(loose)), /refused: .*none of the owner's projects/);
  assert.match(String(ask(loose, env.home, agent("total"))), /refused/, "the chat's own agent is not in total");
  await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
  try {
    const total = ask(loose, env.home, agent("total"));
    assert.ok(typeof total === "object" && total.cwd === realpath(loose), String(total));
    // APX's own folder never.
    assert.match(String(ask(env.home, env.home, agent("total"))), /APX's own folder/);
  } finally {
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
  }
  // A project whose files are restricted to its team stays its own.
  store.projectProtection.protect("move_folder_test", otherId);
  try {
    assert.match(String(ask(other)), /restricted to its team/);
  } finally {
    store.projectProtection.restore("move_folder_test");
  }
  // A read-only folder of the project stays read-only: a session neither works in it nor in a folder holding it.
  const docs = path.join(other, "docs");
  fs.mkdirSync(docs, { recursive: true });
  await env.client.call("projects.update", { project: ownId, read_only_folders: [docs] });
  try {
    for (const folder of [docs, other]) assert.match(String(ask(folder)), /read-only folder/, folder);
    assert.ok(typeof ask(tree) === "object", "a worktree beside it is still the owner's");
  } finally {
    await env.client.call("projects.update", { project: ownId, read_only_folders: [] });
  }
});

test("for a contact, an outside app or without APX's home, a session's folder keeps to its project", async () => {
  const store = env.core.store;
  const person = store.persons.create({ name: "Alex Acme", role: "contact" });
  const contact = store.threads.create({
    kind: "loose",
    title: "Contact Alex",
    agent_ids: ["superagent"],
    project_id: ownId,
    channel: { id: "ch_test", conversation: "alex", person_id: person.id },
  });
  const app = store.threads.create({ kind: "loose", title: "App", agent_ids: ["superagent"], project_id: ownId });
  store.threads.mergeContext(app.id, { client: "external" });
  const owners = store.threads.create({ kind: "loose", title: "Chat", agent_ids: ["superagent"], project_id: ownId });
  const by = agent("total");
  for (const [parent, home] of [
    [contact, env.home],
    [app, env.home],
    [owners, undefined],
  ] as const) {
    const r = workspaceOf(store, by, by, parent, ownId, { folder: other }, home);
    assert.match(String(r), /outside the project's folder/, parent.title);
  }
});

test("the delegate tool takes a worktree beside the owner's project as the session's folder", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: ownId });
  await env.client.call("threads.send", { thread: chat.id, text: `work in ${tree}` });
  await env.settle(chat.id);
  const [session] = env.core.store.threads.sessions(chat.id);
  assert.equal(session?.cwd && realpath(session.cwd), realpath(tree));
  const answer = String(llm.calls.findLast((c) => c.messages.at(-1)?.role === "tool")?.messages.at(-1)?.content);
  assert.doesNotMatch(answer, /no project|refused/);
});
