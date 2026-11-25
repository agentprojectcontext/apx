// How far an outside agent (Claude, Codex) reaches when it runs in APX's side folder: its own project's folder as freely as the
// owner's other projects in Auto, AGENTS.md and APC files still asked, APX's home never (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import { real } from "../paths.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import type { Root } from "../tools/folders.ts";
import { type CodexPlace, codexGuards, codexSandbox, codexWrites } from "./codex.ts";
import { codexPlaceFor, type Harness, type TurnIO } from "./index.ts";

// "probe [...]" asks the core about each of its own tool calls, as Claude Code's canUseTool does.
const claude: Harness = {
  id: "claude",
  async run(io) {
    const asked = JSON.parse(/^probe (\[.*\])$/m.exec(String(io.input.content))?.[1] ?? "[]") as Array<{
      kind: string;
      command?: string;
      path?: string;
    }>;
    const said: boolean[] = [];
    for (const [i, a] of asked.entries()) {
      const input = a.command === undefined ? { path: a.path } : { command: a.command };
      said.push(await io.approve({ callId: `${io.run.id}-p${i}`, title: a.kind, kind: a.kind, input }));
    }
    return { text: JSON.stringify(said), model: "claude/model", sessionId: "probe" };
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("native")), harnesses: { claude } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** A Claude session with no folder of its own in a project whose folder is on disk: it runs in APX's side folder. */
async function chat() {
  const repo = tempDir("apx-harness-reach-").path;
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  // A session started with no folder (a delegation asked for none): stored as such, since the panel always gives one.
  const store = env.core.store;
  const thread = store.threads.create({
    kind: "code",
    title: "Side folder",
    agent_ids: ["superagent"],
    project_id: project,
    engine: "claude",
  });
  store.threads.mergeContext(thread.id, { model_choice: { model: "claude", router: false } });
  return { thread, repo };
}

/** Sends the probe; answers the card it raises with `answer` (deny when none is given), and says whether one came. */
async function probe(thread: string, asks: object[], answer: "approve" | "deny" = "deny") {
  await env.client.call("threads.send", { thread, text: `probe ${JSON.stringify(asks)}` });
  let asked = false;
  await waitFor(async () => {
    const card = (await env.client.call("runs.pending", { thread })).inputs[0];
    if (card) {
      asked = true;
      await env.client.call("runs.respond", { input: card.id, decision: answer });
      return undefined;
    }
    const run = (await env.client.call("threads.get", { thread })).runs[0];
    return run && ["completed", "failed", "canceled"].includes(run.state) ? run : undefined;
  }, "the probe to finish");
  const t = await env.settle(thread);
  return { asked, said: texts(t.messages.slice(-1))[0] };
}

test("an outside agent with no folder of its own changes its project's files in Auto without a card, as the owner's other projects", async () => {
  const { thread, repo } = await chat();
  await env.client.call("agents.update", { agent: "superagent", autonomy: "auto" });
  try {
    const stored = env.core.store.threads.get(thread.id);
    assert.equal(stored?.cwd, undefined, "no folder of its own");
    const edit = await probe(thread.id, [
      { kind: "edit", path: path.join(repo, "src", "a.ts") },
      { kind: "execute", command: `touch ${path.join(repo, "made.txt").split(path.sep).join("/")}` },
    ]);
    assert.equal(edit.asked, false, "no card for its own project");
    assert.equal(edit.said, "[true,true]");
  } finally {
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
    await removeDir(repo);
  }
});

test("AGENTS.md and agent files in its own project still ask; APX's home is refused without a card", async () => {
  const { thread, repo } = await chat();
  await env.client.call("agents.update", { agent: "superagent", autonomy: "auto" });
  try {
    for (const file of [path.join(repo, "AGENTS.md"), path.join(repo, ".apx", "agents", "helper.md")]) {
      const r = await probe(thread.id, [{ kind: "edit", path: file }]);
      assert.equal(r.asked, true, `${file} asks the owner`);
      assert.equal(r.said, "[false]");
    }
    const home = await probe(thread.id, [{ kind: "edit", path: path.join(env.home, "apx.db") }]);
    assert.equal(home.asked, false);
    assert.equal(home.said, "[false]");
  } finally {
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
    await removeDir(repo);
  }
});

// Codex's own sandbox, built from the folder rule's roots: it never asks, so what it may change is set up front.
const home = path.join(os.tmpdir(), "apx-reach-home");
const project = path.join(os.tmpdir(), "apx-reach-acme");
const other = path.join(os.tmpdir(), "apx-reach-northwind");
const closed = path.join(os.tmpdir(), "apx-reach-closed");
const side = path.join(home, "projects", "acme");
const roots: Root[] = [
  { dir: side, write: true, scratch: false },
  { dir: project, write: true, scratch: false },
  { dir: closed, write: false, scratch: false, off: true, protected: true },
  { dir: path.join(other, "vendor"), write: false, scratch: false },
  { dir: other, write: true, scratch: false },
  { dir: path.parse(home).root, write: false, scratch: false, anywhere: { home } },
];
const place: CodexPlace = { home, roots, reach: "read", forOwner: true };
const chatIo = (autonomy: string) =>
  ({ thread: { id: "t1" }, agent: { name: "Ada", autonomy }, outside: () => false }) as unknown as TurnIO;

/** The profile's folders, as Codex reads them. */
function profile(overrides: string[]): Record<string, string> {
  const table = /^permissions\.apx_turn\.filesystem=\{(.*)\}$/.exec(overrides[0] ?? "")?.[1] ?? "";
  return Object.fromEntries(
    [...table.matchAll(/("(?:[^"\\]|\\.)*") = "(\w+)"/g)].map((m) => [JSON.parse(m[1] ?? ""), m[2]]),
  );
}
/** A path's access in the profile, by where it really is (the temp folder may sit behind a link). */
const at = (table: Record<string, string>, p: string) => table[real(p)];

before(() => {
  for (const d of [side, project, closed, path.join(other, "vendor")]) fs.mkdirSync(d, { recursive: true });
});
after(async () => {
  for (const d of [home, project, other, closed]) await removeDir(d);
});

test("Codex with no folder of its own writes the owner's projects in Auto, Accept edits and Total; Plan and Manual read", () => {
  for (const mode of ["auto", "accept_edits", "total"]) assert.equal(codexWrites(chatIo(mode), place), true, mode);
  for (const mode of ["plan", "manual"]) assert.equal(codexWrites(chatIo(mode), place), false, mode);
  assert.equal(codexWrites(chatIo("auto"), { ...place, reach: "fenced" }), false, "a fenced agent keeps reading");
  assert.equal(codexWrites(chatIo("auto"), { ...place, forOwner: false }), false, "a turn for someone else reads");
  assert.equal(codexWrites(chatIo("total")), false, "without its place it keeps reading");

  const sb = codexSandbox({
    cwd: side,
    writes: true,
    git: [],
    guard: codexGuards(chatIo("auto")),
    place,
    platform: "darwin",
  });
  assert.deepEqual(sb.thread, {}, "no sandbox flag: it would override the profile");
  assert.equal(sb.config.default_permissions, "apx_turn");
  assert.equal(sb.config.sandbox_mode, "workspace-write");
  const writable = (sb.config.sandbox_workspace_write as { writable_roots: string[] }).writable_roots;
  assert.deepEqual(writable.map((d) => path.basename(d)).sort(), [path.basename(other), path.basename(project)].sort());
  const fsTable = profile(sb.overrides);
  assert.equal(fsTable[":root"], "read");
  assert.equal(at(fsTable, home), "none", "APX's home is never read");
  assert.equal(at(fsTable, side), "write", "the folder it runs in, inside APX's home");
  assert.equal(at(fsTable, project), "write");
  assert.equal(at(fsTable, other), "write");
  assert.equal(at(fsTable, closed), "none");
  assert.equal(at(fsTable, path.join(other, "vendor")), "read");
  assert.equal(at(fsTable, path.join(project, "AGENTS.md")), "read");
  assert.equal(at(fsTable, path.join(project, ".apx")), "read");
  assert.equal(at(fsTable, path.join(project, ".apx", "worktrees")), "write");
  assert.equal(at(fsTable, path.join(project, ".apc")), "read", "kept until its files move to .apx/");
  assert.equal(at(fsTable, path.join(project, ".apc", "worktrees")), "write");
  assert.equal(at(fsTable, path.join(project, ".claude", "settings.json")), "read");

  const total = profile(
    codexSandbox({ cwd: side, writes: true, git: [], guard: codexGuards(chatIo("total")), place, platform: "darwin" })
      .overrides,
  );
  assert.equal(at(total, path.join(project, "AGENTS.md")), undefined, "Total changes them on its own");
  assert.equal(at(total, home), "none");
});

test("Codex in a turn not for the owner (a code thread an outside app reaches) writes its folder and temp, never the owner's projects", () => {
  const temp = path.join(os.tmpdir(), "apx-reach-temp");
  const stranger: CodexPlace = {
    ...place,
    roots: [...roots.slice(0, 1), { dir: temp, write: true, scratch: true }, ...roots.slice(1)],
    forOwner: false,
  };
  const sb = codexSandbox({ cwd: side, writes: true, git: [], guard: true, place: stranger, platform: "darwin" });
  const table = profile(sb.overrides);
  assert.equal(at(table, side), "write");
  assert.equal(at(table, temp), "write");
  assert.equal(at(table, project), undefined, "its project stays readable only");
  assert.equal(at(table, other), undefined, "the owner's other projects stay readable only");
  assert.equal(at(table, home), "none");
  const writable = (sb.config.sandbox_workspace_write as { writable_roots: string[] }).writable_roots;
  assert.deepEqual(writable, [real(temp)]);
});

test("Codex reading keeps APX's home closed too; without its place or on Windows it keeps the plain sandbox", () => {
  const ro = codexSandbox({ cwd: side, writes: false, git: [], guard: true, place, platform: "darwin" });
  assert.equal(ro.config.sandbox_mode, "read-only");
  assert.equal(ro.config.sandbox_workspace_write, undefined);
  const fsTable = profile(ro.overrides);
  assert.equal(at(fsTable, home), "none");
  assert.equal(at(fsTable, side), "read");
  assert.equal(at(fsTable, project), undefined, "nothing writable");
  assert.ok(!Object.values(fsTable).includes("write"));

  const plain = codexSandbox({
    cwd: side,
    writes: true,
    git: ["/repo/.git/worktrees/x"],
    guard: true,
    platform: "darwin",
  });
  assert.deepEqual(plain, {
    thread: { sandboxMode: "workspace-write", additionalDirectories: ["/repo/.git/worktrees/x"] },
    config: {},
    overrides: [],
  });
  const win = codexSandbox({ cwd: side, writes: false, git: [], guard: true, place, platform: "win32" });
  assert.deepEqual(win.thread, { sandboxMode: "read-only" });
  assert.deepEqual(win.overrides, []);
});

test("Codex's place: the owner's other projects even in Total, never every folder; a turn for a contact is not the owner's", async () => {
  const { thread, repo } = await chat();
  const away = tempDir("apx-harness-other-").path;
  await env.client.call("projects.register", { path: away, init: true });
  await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
  try {
    const store = env.core.store;
    const agent = store.agents.get("superagent");
    const t = store.threads.get(thread.id);
    assert.ok(agent && t);
    const placeOf = codexPlaceFor(store, env.home);
    const p = placeOf({ agent: { ...agent, autonomy: "total" }, thread: t });
    assert.equal(p.reach, "all");
    assert.equal(p.forOwner, true);
    assert.ok(!p.roots.some((r) => r.anywhere && r.write), "no root opens every folder");
    const sb = codexSandbox({
      cwd: p.roots[0]?.dir ?? "",
      writes: true,
      git: [],
      guard: false,
      place: p,
      platform: "darwin",
    });
    const table = profile(sb.overrides);
    assert.equal(at(table, repo), "write", "its own project");
    assert.equal(at(table, away), "write", "the owner's other project");
    assert.equal(at(table, env.home), "none");
    store.threads.mergeContext(t.id, { client: "app_1" });
    assert.equal(placeOf({ agent, thread: t }).forOwner, false);
  } finally {
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
    await removeDir(repo);
    await removeDir(away);
  }
});
