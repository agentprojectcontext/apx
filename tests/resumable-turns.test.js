// What survives a restart, and what is deliberately let go.
//
// The drain cuts off the turns it cannot wait for, and writes them down so the
// next daemon can finish them. Two judgement calls decide whether that is a
// feature or a liability, and both are tested here: WHICH turns are worth
// carrying, and the one-attempt rule that stops a bad record becoming a daemon
// that will not boot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-resumable-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // APX_HOME wins over HOME — set both

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  isWorthResuming, readResumableTurns, writeResumableTurns, saveResumableTurns, claimResumableTurns,
} = await import("#core/stores/resumable-turns.js");

const turn = (over = {}) => ({
  turn_id: "turn_1", project_id: 1, agent_slug: "magui", conversation_id: "conv_1",
  prompt: "revisá los turnos del martes", partial_text: "", effects: [], in_flight: [],
  ...over,
});

test("a turn that did nothing is not carried across the restart", () => {
  // Relaunching this buys exactly what retyping the message buys, and costs
  // every risk a resume carries.
  assert.equal(isWorthResuming(turn()), false);
});

test("one completed tool is enough, even with nothing said", () => {
  // The more important half: that tool may have changed the world, so this is
  // precisely the turn whose resume must know what already ran.
  assert.equal(isWorthResuming(turn({ effects: [{ tool: "send_whatsapp", args: {}, result: { ok: true } }] })), true);
});

test("a tool that never came back counts as work — it is the case that most needs carrying", () => {
  // Its side effect may well have landed. Dropping the turn would leave nobody
  // aware that a message might be out there; the resume at least hands the
  // agent something it can act on.
  assert.equal(isWorthResuming(turn({ in_flight: [{ tool: "send_telegram", args: {} }] })), true);
});

test("text with no tools is enough too", () => {
  assert.equal(isWorthResuming(turn({ partial_text: "encontré tres, el primero es" })), true);
});

test("whitespace is not work", () => {
  assert.equal(isWorthResuming(turn({ partial_text: "   \n  " })), false);
});

test("no prompt, no resume — a relaunch without the request is a guess", () => {
  // This is what keeps the surfaces that record no prompt (a group cascade, an
  // external coding runtime holding its own session) out of the resume path
  // instead of being relaunched from half a record.
  assert.equal(isWorthResuming(turn({ prompt: "", effects: [{ tool: "run_shell", args: {}, result: {} }] })), false);
  assert.equal(isWorthResuming(null), false);
});

test("saving keeps the worthwhile and drops the rest", () => {
  writeResumableTurns([]);
  const saved = saveResumableTurns([
    turn({ turn_id: "empty" }),
    turn({ turn_id: "worked", partial_text: "ya casi" }),
  ]);
  assert.equal(saved, 1);
  assert.deepEqual(readResumableTurns().map((t) => t.turn_id), ["worked"]);
});

test("saving appends instead of overwriting", () => {
  // Two surfaces can be cut off by the same shutdown; the second write must not
  // erase the first.
  writeResumableTurns([]);
  saveResumableTurns([turn({ turn_id: "a", partial_text: "x" })]);
  saveResumableTurns([turn({ turn_id: "b", partial_text: "y" })]);
  assert.deepEqual(readResumableTurns().map((t) => t.turn_id), ["a", "b"]);
});

test("claiming empties the file BEFORE anything runs — one attempt, never a loop", () => {
  // The poison-pill rule. A record that makes the resume throw must not still
  // be there at the next boot to throw again: that turns one bad turn into a
  // daemon that cannot start.
  writeResumableTurns([]);
  saveResumableTurns([turn({ turn_id: "poison", partial_text: "boom" })]);
  const claimed = claimResumableTurns();
  assert.equal(claimed.length, 1);
  assert.deepEqual(readResumableTurns(), [], "a second boot would run it again");
  assert.deepEqual(claimResumableTurns(), []);
});

test("a corrupt file reads as empty instead of blocking the boot", () => {
  // It is written by a process being killed, so a half-written file is a real
  // possibility. Forgetting those turns is bad; refusing to start is worse.
  fs.writeFileSync(path.join(process.env.APX_HOME, "resumable-turns.json"), "{ this is not json");
  assert.deepEqual(readResumableTurns(), []);
  assert.deepEqual(claimResumableTurns(), []);
});

test("it is written under APX_HOME, never into the repo", () => {
  writeResumableTurns([]);
  saveResumableTurns([turn({ turn_id: "z", partial_text: "x" })]);
  assert.ok(fs.existsSync(path.join(process.env.APX_HOME, "resumable-turns.json")),
    "anything written with no human reading it belongs in ~/.apx");
});
