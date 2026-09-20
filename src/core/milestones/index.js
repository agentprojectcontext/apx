// The timeline: derived steps and declared milestones, merged into one list.
//
// TWO SOURCES, ONE READING ORDER. `derive.js` reads the spine off the turns and
// always produces something; the store holds what the agent actually declared
// and is richer but optional. Merging them is not a preference between the two
// — a declared milestone belongs INSIDE the request that produced it, because
// that is where a reader looks for it. So the derived step is the container and
// the declared ones are its detail.
//
// A milestone that lands inside no step still shows, as an entry of its own.
// Dropping it would be the worst of the options: a thing the agent went out of
// its way to record, silently discarded because the arithmetic around it did
// not line up.
//
// EVERY READ HERE IS ASYNC (rule 15). These run on request paths — the chat
// opening, the panel polling — and the stores they sit on are day and month
// files that a busy project has a lot of.
import fs from "node:fs/promises";
import path from "node:path";
import { parseConversation, conversationPath } from "#core/stores/conversations.js";
import { readProjectMessagesInRange } from "#core/stores/messages.js";
import { listMilestones, milestoneStats } from "#core/stores/milestones.js";
import { isoToMs } from "#core/util/time.js";
import { deriveSteps } from "./derive.js";

export { deriveSteps, stepTitle } from "./derive.js";

/** How far back the cross-chat view looks when nobody says. A week is what
 *  "what has been going on" means to a person asking on a Monday. */
export const DEFAULT_TIMELINE_DAYS = 7;

/** An ISO day bound N days before now, for the default range. */
export function sinceDaysAgo(days = DEFAULT_TIMELINE_DAYS) {
  const d = new Date(Date.now() - Math.max(0, days) * 86400_000);
  return d.toISOString().slice(0, 10) + "T00:00:00Z";
}

/**
 * Place declared milestones inside the derived steps that contain them.
 *
 * A step's span runs from its own start to the start of the next one — NOT to
 * its own `ended_at`. A milestone declared by the agent lands while the turn is
 * running, but an agent that records a step after answering (or a wake-up that
 * lands between turns) would fall in the gap between `ended_at` and the next
 * request, and be orphaned for no reason a reader would recognise.
 */
export function mergeTimeline(steps, milestones) {
  const entries = (Array.isArray(steps) ? steps : []).map((s) => ({ ...s, milestones: [] }));
  const rows = Array.isArray(milestones) ? milestones : [];
  const orphans = [];

  for (const m of rows) {
    const at = isoToMs(m.started_at);
    let slot = -1;
    for (let i = 0; i < entries.length; i += 1) {
      const from = isoToMs(entries[i].started_at);
      const next = i + 1 < entries.length ? isoToMs(entries[i + 1].started_at) : Infinity;
      if (at >= from && at < next) {
        slot = i;
        break;
      }
    }
    if (slot >= 0) entries[slot].milestones.push(m);
    else orphans.push({ kind: "declared", ...m, milestones: [] });
  }

  return [...entries, ...orphans].sort(
    (a, b) => isoToMs(a.started_at) - isoToMs(b.started_at)
  );
}

/**
 * Roll a merged entry list up into the line a header shows.
 *
 * A step's state is its own unless it carries declared milestones that
 * disagree: an agent that says "the render failed" inside a turn that answered
 * normally is the more specific witness, and a rail that showed that step green
 * would be actively misleading.
 */
export function timelineStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const states = list.map((e) => {
    const declared = Array.isArray(e.milestones) ? e.milestones : [];
    if (declared.some((m) => m.state === "failed")) return "failed";
    if (e.state === "failed") return "failed";
    if (declared.some((m) => m.state === "open")) return "open";
    return e.state;
  });
  return {
    total: states.length,
    open: states.filter((s) => s === "open").length,
    done: states.filter((s) => s === "done").length,
    failed: states.filter((s) => s === "failed").length,
  };
}

/**
 * Turns in, timeline out. The seam for a caller that already HAS the turns and
 * only needs them read as steps — the thread route, where which of three stores
 * holds a thread is the adapter's business and not core's.
 */
export function timelineFromTurns(turns, declared = []) {
  const entries = mergeTimeline(deriveSteps(turns), declared);
  return { entries, stats: timelineStats(entries) };
}

/**
 * The timeline of ONE chat: the derived spine of that conversation file, with
 * whatever the agent declared inside it.
 *
 * @returns {Promise<{entries: object[], stats: object}>} — an empty timeline,
 *          never null, for a conversation that does not exist. A chat with no
 *          file yet is a chat with no steps, which is a true answer; making the
 *          caller branch on null buys nothing.
 */
export async function conversationTimeline({ storagePath, agentSlug, conversationId }) {
  const file = conversationPath(storagePath, agentSlug, conversationId);
  let turns = [];
  try {
    turns = parseConversation(await fs.readFile(file, "utf8")).turns;
  } catch {
    turns = [];
  }
  const declared = listMilestones(storagePath, { conversation_id: conversationId });
  const entries = mergeTimeline(deriveSteps(turns), declared);
  return { entries, stats: timelineStats(entries) };
}

/**
 * The timeline ACROSS chats: every request in the range, whichever channel it
 * arrived on, in the order it happened.
 *
 * Built from the ledger rather than from the conversation files, and that is
 * the whole reason this is affordable. The ledger is one file per day: a range
 * opens the files in the range and nothing else, while walking conversations
 * would mean opening every chat a project has ever had to answer "what happened
 * this week".
 *
 * Rows are grouped into threads before deriving, because a day file interleaves
 * every channel at once — deriving over the raw sequence would pair a Telegram
 * question with a web answer that had nothing to do with it.
 */
export async function projectTimeline({
  storagePath,
  since = sinceDaysAgo(),
  until = null,
  limit = 200,
} = {}) {
  // The ledger and the milestone store are both under the project's storage
  // root — `messages/` and `milestones/` beside each other. Taking one path and
  // not two is deliberate: a pair of parameters that must always hold the same
  // value is a pair somebody eventually passes differently.
  const rows = await readProjectMessagesInRange(storagePath, { since, until });

  const threads = new Map();
  for (const row of rows) {
    const role = ledgerRole(row);
    if (!role) continue;
    const key = [row.agent_slug || "", row.channel || "", row.meta?.conversation || ""].join("|");
    if (!threads.has(key)) threads.set(key, { key, channel: row.channel || null, agent: row.agent_slug || null, conversation_id: row.meta?.conversation || null, turns: [] });
    threads.get(key).turns.push({ role, ts: row.ts, content: row.body || "", meta: row.meta || null });
  }

  // A MISSING CONVERSATION ID IS NOT AN IDENTITY, and treating it as one is a
  // lie with a face on it. Grouping on `conversation_id || ""` put every
  // milestone recorded outside a conversation — the super-agent's own threads,
  // where a turn is addressed by channel and day — into one bucket keyed by the
  // empty string, and handed the whole bucket to whichever thread also had no
  // conversation id. Seen live the day this shipped: four milestones written at
  // 23:51 by a CLI turn rendered underneath a scheduled run from 20:00, because
  // that step was open-ended and the window swallowed them.
  //
  // So only a REAL id joins a thread. The rest keep their own row: we know when
  // they happened and on which channel, and not which thread — which is exactly
  // what gets shown.
  const declared = listMilestones(storagePath, { since });
  const byConversation = new Map();
  const unplaced = [];
  for (const m of declared) {
    if (!m.conversation_id) {
      unplaced.push(m);
      continue;
    }
    if (!byConversation.has(m.conversation_id)) byConversation.set(m.conversation_id, []);
    byConversation.get(m.conversation_id).push(m);
  }

  const entries = [];
  for (const thread of threads.values()) {
    const steps = deriveSteps(thread.turns).map((s) => ({
      ...s,
      channel: thread.channel,
      agent: s.agent || thread.agent,
      conversation_id: thread.conversation_id,
    }));
    const mine = thread.conversation_id ? byConversation.get(thread.conversation_id) || [] : [];
    entries.push(...mergeTimeline(steps, mine));
    if (thread.conversation_id) byConversation.delete(thread.conversation_id);
  }
  // Declared milestones whose conversation left no ledger rows in the range
  // still belong in the answer — a routine that declared its steps and posted
  // nowhere is exactly the run nobody would otherwise hear about.
  for (const rest of [...byConversation.values(), unplaced]) {
    entries.push(...rest.map((m) => ({ kind: "declared", ...m, milestones: [] })));
  }

  entries.sort((a, b) => isoToMs(a.started_at) - isoToMs(b.started_at));
  const capped = Number.isFinite(limit) && limit > 0 ? entries.slice(-limit) : entries;
  return { entries: capped, stats: timelineStats(capped), declared: milestoneStats(declared) };
}

/** Ledger `type` → the role `deriveSteps` speaks. `system` and anything
 *  unrecognised is scaffolding and carries no step. */
function ledgerRole(row) {
  switch (row?.type) {
    case "user":
      return "user";
    case "agent":
      return "assistant";
    case "tool":
      return "tool";
    default:
      return null;
  }
}

/** Re-exported so a caller that only wants the raw declared rows does not have
 *  to import two modules to get a timeline and its store. */
export { listMilestones, milestoneStats } from "#core/stores/milestones.js";

/** Resolve the conversation file path without leaking the layout to callers. */
export function timelineConversationFile(storagePath, agentSlug, conversationId) {
  return path.normalize(conversationPath(storagePath, agentSlug, conversationId));
}
