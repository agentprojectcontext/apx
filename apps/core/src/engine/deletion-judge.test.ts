import assert from "node:assert/strict";
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
  const dir = tempDir("apx-judge-");
  const store = createStore(openDb(dir.path), createBus());
  const call = (judge: AuxJudge | undefined, command: string, untrusted = false): DeletionCall => ({
    store,
    run: { id: "run_x", started_at: new Date().toISOString() } as RunRecord,
    agentId: "superagent",
    thread: { id: "th_x", kind: "loose", created_at: new Date().toISOString() },
    deletion: deletionTargets(command, dir.path),
    place: { roots: [dir.path], scratch: path.join(dir.path, "scratch") },
    reason: "Leftovers of a canceled run",
    judge,
    untrusted,
  });
  return { dir, call };
}

const REMOTE = "ssh box 'rm -r ~/ci/slots/x/coverage'";

test("the judge decides only what the rules leave open, within its deadline; any doubt is a card", async () => {
  const { dir, call } = await setup();
  await using _ = dir;
  const asked: Array<{ user: string; timeoutMs: number | undefined; purpose: string }> = [];
  const answering =
    (text: string | Error): AuxJudge =>
    async (_system, user, about, _models, timeoutMs) => {
      asked.push({ user, timeoutMs, purpose: about.purpose });
      if (text instanceof Error) throw text;
      return text;
    };
  assert.equal(await deletionRuns(call(answering('{"decision":"run","why":"CI leftovers"}'), REMOTE)), true);
  assert.deepEqual(
    { timeoutMs: asked[0]?.timeoutMs, purpose: asked[0]?.purpose },
    { timeoutMs: JUDGE_MS, purpose: "deletion" },
  );
  assert.match(asked[0]?.user ?? "", /rm -r ~\/ci\/slots\/x\/coverage[\s\S]*Leftovers of a canceled run/);
  for (const answer of ['{"decision":"ask"}', "Sure, go ahead.", "", new Error("timed out")])
    assert.equal(await deletionRuns(call(answering(answer), REMOTE)), false, String(answer));
  assert.equal(await deletionRuns(call(undefined, REMOTE)), false, "no auxiliary model: a card");
  // Outside content in the turn: the judge is told only the owner, the task or a rule can back it.
  await deletionRuns(call(answering('{"decision":"ask"}'), REMOTE, true));
  assert.match(asked.at(-1)?.user ?? "", /Outside content .* answer run only if the owner's words/);
  // What the rules settle never reaches it.
  const before = asked.length;
  assert.equal(await deletionRuns(call(answering('{"decision":"run"}'), "rm -rf coverage")), true);
  assert.equal(await deletionRuns(call(answering('{"decision":"run"}'), "git stash drop")), false);
  assert.equal(asked.length, before);
});
