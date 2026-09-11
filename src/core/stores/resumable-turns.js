// Turns the daemon had to cut off, kept so the next daemon can pick them up.
//
// The live-turn registry (host/daemon/active-turns.js) is pure memory and says
// so: "if the daemon restarts mid-turn the turn is gone anyway". The drain made
// most of that moot — a turn that can finish in ten seconds now finishes — but
// the long tail still gets cut, and "cut off" used to be the end of the story.
// A turn that had run fifty steps over ten minutes left a mid-sentence message
// in the thread and nothing else. This is the missing half: what it was asked,
// what it had already said, and what it had already DONE, written down at the
// moment it is cut, so a resume is a continuation rather than a re-run.
//
// It lives under ~/.apx, never in the repo: nothing writes into a committed
// path without a person reading it first.
//
// One flat file rather than per-project ones, because the reader is the daemon
// at boot and it needs to find every pending turn before it knows which
// projects it has.
import fs from "node:fs";
import path from "node:path";
import { apxHome } from "#core/config/paths.js";

/** Resolved per call, not at import: tests relocate APX_HOME after loading. */
function storePath() {
  return path.join(apxHome(), "resumable-turns.json");
}

/**
 * Is this turn worth carrying across a restart?
 *
 * A turn that started three seconds ago and produced nothing is not the same
 * animal as one that ran fifty steps over ten minutes, and treating them alike
 * is how a resume becomes a liability. Relaunching an empty turn buys exactly
 * what re-sending the message by hand would buy, while adding every risk a
 * resume carries — so the empty ones are dropped and only work that exists is
 * carried.
 *
 * "Did something" is deliberately generous about WHAT: a turn that ran one tool
 * and said nothing did something (and is in fact the more important case, since
 * that tool may have changed the world), and so did one that wrote text without
 * calling anything.
 */
export function isWorthResuming(rec) {
  if (!rec) return false;
  // No prompt, no resume: without what it was asked, a relaunch is a guess.
  // Surfaces that do not record one (a group cascade, an external coding
  // runtime that keeps its own session) simply never become resumable.
  if (!String(rec.prompt || "").trim()) return false;
  if (rec.effects?.length) return true;
  // A call that had LEFT and had not come back counts as having done something
  // — in fact it is the case that most needs carrying. Dropping it would make
  // the turn vanish while its side effect may well have landed, leaving nobody
  // aware that a message might be out there. The resume cannot confirm it
  // either, but it can hand the agent the one thing it can act on: go and look.
  if (rec.in_flight?.length) return true;
  return !!String(rec.partial_text || "").trim();
}

/** Every turn waiting to be picked up. Never throws: a corrupt file is treated
 *  as an empty one, because failing to boot over it would be worse than
 *  forgetting the turns it held. */
export function readResumableTurns() {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Replace the whole file.
 *
 * SYNCHRONOUS on purpose, and the one place in this module that has to be. Its
 * caller is the shutdown path: the process is on its way out with a watchdog
 * already armed behind it, and an async write there is a write that loses the
 * race with `process.exit` — which would leave exactly the silent data loss
 * this file exists to end. Rule 15 bans sync I/O on the REQUEST path; nothing
 * here is ever on one.
 */
export function writeResumableTurns(list) {
  const file = storePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list ?? [], null, 2));
    return true;
  } catch {
    // Best-effort by design: losing the resume record is bad, but throwing
    // here would break the shutdown that is trying to save it.
    return false;
  }
}

/** Add turns to whatever is already pending, dropping the ones not worth it. */
export function saveResumableTurns(records = []) {
  const worth = records.filter(isWorthResuming);
  if (!worth.length) return 0;
  writeResumableTurns([...readResumableTurns(), ...worth]);
  return worth.length;
}

/**
 * Take everything pending and empty the file in one move.
 *
 * Claimed rather than read, and emptied BEFORE any of it runs, because the
 * alternative is a poison pill. A record that makes the resume crash would
 * otherwise still be there at the next boot, crash again, and turn one bad turn
 * into a daemon that cannot start. A resume gets exactly one attempt.
 */
export function claimResumableTurns() {
  const pending = readResumableTurns();
  if (pending.length) writeResumableTurns([]);
  return pending;
}
