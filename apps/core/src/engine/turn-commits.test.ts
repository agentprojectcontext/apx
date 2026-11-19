// Each commit writes the log on the event loop and brings the next checkpoint closer: a plain turn keeps a fixed, small number.
// Commits are counted in the store's write-ahead log, where each one ends with a commit frame. See DECISIONS.md#d-251
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** A plain owner turn, from the words sent to the run's end. Lower it when a change saves commits. */
const MAX_COMMITS_PER_TURN = 10;
const TURNS = 3;

/** The log's current generation (its salt) and how many commits it holds. */
function walCommits(home: string): { salt: string; commits: number } {
  const file = path.join(home, "apx.db-wal");
  const buf = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  if (buf.length < 32) return { salt: "", commits: 0 };
  const page = buf.readUInt32BE(8);
  const salt = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  let commits = 0;
  // A frame is a 24-byte header and a page; frames from an older generation carry another salt and are not counted.
  for (let at = 32; at + 24 + page <= buf.length; at += 24 + page) {
    if (buf.readUInt32BE(at + 8) !== salt[0] || buf.readUInt32BE(at + 12) !== salt[1]) break;
    if (buf.readUInt32BE(at + 4) !== 0) commits++;
  }
  return { salt: salt.join(":"), commits };
}

test("a plain chat turn commits to the store a bounded number of times", async () => {
  const env = await startCore({ llm: scriptedLlm(async () => say("Done.")) });
  try {
    const thread = (await env.client.call("threads.create", { kind: "agent", agent_id: "superagent" })).id;
    // The first turn of a chat writes what later turns only read (its roster): it is not the steady cost.
    await env.client.call("threads.send", { thread, text: "first" });
    await env.settle(thread);
    // An empty log, so no automatic checkpoint starts a new generation while the turns are counted.
    const side = new DatabaseSync(path.join(env.home, "apx.db"));
    side.exec("PRAGMA busy_timeout = 5000; PRAGMA wal_checkpoint(TRUNCATE)");
    side.close();
    const before = walCommits(env.home);
    for (let i = 0; i < TURNS; i++) {
      await env.client.call("threads.send", { thread, text: `turn ${i}` });
      await env.settle(thread);
    }
    const after = walCommits(env.home);
    assert.ok(!before.salt || before.salt === after.salt, "the log was checkpointed while turns were counted");
    const perTurn = (after.commits - before.commits) / TURNS;
    assert.ok(perTurn > 0, "no commits seen: the log is not where the store writes");
    assert.ok(
      perTurn <= MAX_COMMITS_PER_TURN,
      `a turn commits ${perTurn} times, more than ${MAX_COMMITS_PER_TURN}: group the new writes in one store.tx`,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
