import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import type { RunRecord } from "../domain/runs.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { deletionTargets } from "../tools/command-deletions.ts";
import { type AuxJudge, type DeletionCall, deletionRuns, JUDGE_MS } from "./deletion-judge.ts";

async function setup() {
  const folder = tempDir("apx-judge-");
  const db = openDb(folder.path);
  // The database closes before its folder goes: Windows cannot remove an open one.
  const dir = {
    path: folder.path,
    [Symbol.asyncDispose]: async () => {
      db.close();
      await folder.remove();
    },
  };
  const store = createStore(db, createBus());
  const call = (judge: AuxJudge | undefined, command: string, untrusted = false): DeletionCall => ({
    store,
    run: { id: "run_x", started_at: new Date().toISOString() } as RunRecord,
    agentId: "superagent",
    thread: { id: "th_x", kind: "loose", created_at: new Date().toISOString() },
    deletion: { ...deletionTargets(command, dir.path), root: dir.path },
    place: { roots: [dir.path], scratch: path.join(dir.path, "scratch") },
    reason: "Leftovers of a canceled run",
    judge,
    untrusted,
    callId: "call_1",
    command,
  });
  return { dir, store, call };
}

const REMOTE = "ssh box 'rm -r ~/ci/slots/x/coverage'";

test("the judge decides only what the rules leave open, within its deadline; any doubt is a card", async () => {
  const { dir, call } = await setup();
  await using _ = dir;
  const asked: Array<{ user: string; timeoutMs: number | undefined; purpose: string }> = [];
  const answering =
    (text: string | Error): AuxJudge =>
    async (_system, user, about, timeoutMs) => {
      asked.push({ user, timeoutMs, purpose: about.purpose });
      if (text instanceof Error) throw text;
      return { text, model: "openai/gpt-4o-mini" };
    };
  assert.equal((await deletionRuns(call(answering('{"decision":"run","why":"CI leftovers"}'), REMOTE))).runs, true);
  assert.deepEqual(
    { timeoutMs: asked[0]?.timeoutMs, purpose: asked[0]?.purpose },
    { timeoutMs: JUDGE_MS, purpose: "deletion" },
  );
  assert.match(asked[0]?.user ?? "", /rm -r ~\/ci\/slots\/x\/coverage[\s\S]*Leftovers of a canceled run/);
  assert.match(asked[0]?.user ?? "", /write it in Spanish/, "the owner reads its why in their language");
  for (const answer of ['{"decision":"ask"}', "Sure, go ahead.", "", new Error("timed out")])
    assert.equal((await deletionRuns(call(answering(answer), REMOTE))).runs, false, String(answer));
  assert.equal((await deletionRuns(call(undefined, REMOTE))).runs, false, "no auxiliary model: a card");
  // Outside content in the turn: the judge is told only the owner, the task or a rule can back it.
  await deletionRuns(call(answering('{"decision":"ask"}'), REMOTE, true));
  assert.match(asked.at(-1)?.user ?? "", /Outside content .* answer run only if the owner's words/);
  // What the rules settle never reaches it.
  const before = asked.length;
  assert.equal((await deletionRuns(call(answering('{"decision":"run"}'), "rm -rf coverage"))).runs, true);
  assert.equal((await deletionRuns(call(answering('{"decision":"run"}'), "git stash drop"))).runs, false);
  assert.equal(asked.length, before);
});

test("each decision is kept with what went, who decided and why, newest first (DECISIONS.md#d-281)", async () => {
  const { dir, store, call } = await setup();
  await using _ = dir;
  fs.mkdirSync(path.join(dir.path, "coverage"));
  fs.mkdirSync(path.join(dir.path, "dist"));
  const judge: AuxJudge = async () => ({
    text: '{"decision":"run","why":"restos de CI cancelado"}',
    model: "openai/x",
  });
  const ran = await deletionRuns(call(judge, `echo done && ${REMOTE}`));
  assert.deepEqual(
    { ...ran.note, id: "" },
    {
      id: "",
      kind: "deletion",
      verdict: "run",
      by: "judge",
      reasons: ["runtime"],
      why: "restos de CI cancelado",
      model: "openai/x",
      items: [`Se sabe recién al correr: ${REMOTE}`],
    },
  );
  const output = await deletionRuns(call(judge, "rm -rf coverage dist"));
  assert.deepEqual([output.note.by, output.note.verdict, output.note.reasons], ["rule", "run", ["output"]]);
  assert.deepEqual(output.note.items, ["coverage", "dist"]);
  const stash = await deletionRuns(call(judge, "git stash drop"));
  assert.deepEqual([stash.note.verdict, stash.note.reasons], ["ask", ["git_work"]]);
  const silent = await deletionRuns(call(undefined, REMOTE));
  assert.deepEqual(
    [silent.note.by, silent.note.verdict, silent.note.why, silent.note.model],
    ["judge", "ask", undefined, undefined],
  );
  const page = store.autoDecisions.page({ limit: 3 });
  assert.equal(page.decisions.length, 3);
  assert.ok(page.next);
  assert.deepEqual(
    page.decisions.map((d) => d.id),
    [silent.note.id, stash.note.id, output.note.id],
  );
  assert.equal(page.decisions[2]?.command, "rm -rf coverage dist");
  assert.equal(page.decisions[0]?.thread_id, "th_x");
  assert.deepEqual(
    store.autoDecisions.page({ limit: 10, verdict: "run" }).decisions.map((d) => d.id),
    [output.note.id, ran.note.id],
  );
  assert.equal(store.autoDecisions.page({ limit: 10, before: page.next }).decisions[0]?.id, ran.note.id);
  // The record shows only what deletes of a longer command.
  assert.equal(store.autoDecisions.page({ limit: 10, verdict: "run" }).decisions[1]?.command, REMOTE);
});
