// What on a task is asking for the owner's attention.
//
// Three questions the surfaces kept answering differently, now answered once:
//
//   · has anything happened here that nobody has read?      → `activity_at`
//   · is the thread waiting on the OWNER specifically?      → `awaits_owner`
//   · is this task stuck on the owner rather than moving?   → `blocked_by_owner`
//
// They are separate on purpose. A card can have new activity without needing a
// reply (an agent posted a result), need a reply without being blocked (it was
// asked a question while still running), or be blocked with nothing new to read
// (it has sat there since Tuesday). Collapsing any two of them produces a dot
// that means "something, somewhere" — which is the dot nobody clears.
//
// PURE, AND CONFIG-FREE. Everything here takes what it needs as an argument,
// for the same reason core/stores/tasks.js does: the roster and the owner's
// name can change, and a thread should keep saying who was actually addressed
// on the day it was written. The caller that knows the identity resolves the
// aliases (see `ownerAliasesFrom`) and passes them in.
import { OWNER_ACTOR_ID } from "#core/constants/actors.js";
import { normalizeMention } from "#core/agent/group/turn-resolver.js";

/** The status an open task sits in when it is waiting on a human or an agent. */
export const BLOCKED_STATUS = "blocked";

/**
 * Every token that addresses the owner in a comment.
 *
 * `owner` because that is the actor id storage signs their comments with, and
 * `human` because `normalizeTaskAssignee` already accepts it as a spelling of
 * the same person — an assignee vocabulary and a mention vocabulary that
 * disagree is how "@human, ping" fails to reach the human.
 *
 * Then the owner's real name, resolved by the caller from identity.json, and
 * each word of it: "@Manu" has to land for the person whose `owner_name` is
 * "Manu Bruna", which is the mention the feature was asked for. Same rule the
 * group chat uses for agents (`aliasesFor`), so "@Manu", "@manu" and "@Manú"
 * are one person on every surface.
 *
 * @param {string|null} ownerName  identity.json's `owner_name`, or null
 * @returns {string[]} normalized alias tokens
 */
export function ownerAliasesFrom(ownerName) {
  const out = new Set([OWNER_ACTOR_ID, "human"]);
  const add = (v) => { const n = normalizeMention(v); if (n) out.add(n); };
  if (ownerName && typeof ownerName === "string") {
    add(ownerName);
    add(ownerName.replace(/\s+/g, ""));
    for (const word of ownerName.split(/\s+/)) add(word);
  }
  return [...out];
}

/**
 * Does this text @-mention the owner?
 *
 * The group chat's mention parser deliberately cannot answer this: it filters
 * owner participants out, because mentioning the owner must never SUMMON
 * anything — the owner speaks by typing. That is still true. This is the other
 * half of the same fact: nobody gets a turn, but the person does get told.
 */
export function mentionsOwner(text, aliases) {
  if (!text || !aliases?.length) return false;
  const want = new Set(aliases);
  // The same token shape the group chat's parser accepts, so a mention that
  // summons an agent and one that flags the owner are written identically.
  const re = /@([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (want.has(normalizeMention(m[1]))) return true;
  }
  return false;
}

/** Was this comment written by the owner? */
export function isOwnerComment(comment) {
  return (comment?.by || null) === OWNER_ACTOR_ID;
}

/**
 * Does this comment address the owner?
 *
 * `mentions_owner` on the event when it is there — resolved at WRITE time by
 * the route, the same way agent `mentions` are, so a thread keeps saying who
 * was actually named that day. `aliases` is the fallback for every comment
 * written before the flag existed: without it the feature would only work on
 * threads started after the upgrade, which on a real backlog means it appears
 * to not work at all.
 */
export function commentAddressesOwner(comment, aliases) {
  if (!comment || isOwnerComment(comment)) return false;
  if (typeof comment.mentions_owner === "boolean") return comment.mentions_owner;
  return mentionsOwner(comment.text, aliases);
}

/**
 * When somebody OTHER THAN THE OWNER last did something here.
 *
 * The analogue of the inbox's `preview_at`, and picked for the same reason
 * (core/stores/read-marks.js): `updated_at` also moves for the owner's own
 * comment and for every field they edit, so a watermark on it would clear the
 * dot the moment they typed and raise it again on their own next keystroke.
 *
 * A task FILED by somebody else counts even with an empty thread: a routine
 * that lodges three tasks at nine in the morning is exactly the activity this
 * is for, and it has no comment to point at. Field edits do not count — the
 * `update` op carries no author, so attributing one would be a guess.
 *
 * @returns {string} ISO stamp, or "" when nothing here is anyone else's doing
 */
export function activityAt(task) {
  const comments = Array.isArray(task?.comments) ? task.comments : [];
  for (let i = comments.length - 1; i >= 0; i--) {
    if (!isOwnerComment(comments[i])) return String(comments[i].ts || "");
  }
  const by = task?.created_by || null;
  if (by && by !== OWNER_ACTOR_ID) return String(task.created_at || "");
  return "";
}

/**
 * The newest comment, trimmed to what a row can show.
 *
 * Lists drop the thread and only count it (core/stores/tasks.js `row`), which
 * left every card saying "3 comments" and none of them saying who spoke or what
 * about. A preview is the whole difference between a row you can triage and a
 * row you have to open.
 *
 * Truncated here rather than in the panel: the phone pays for this field on
 * every row of every page, and a 4kB agent report quoted in full on fifty rows
 * is a payload nobody on that screen reads.
 */
export const PREVIEW_CHARS = 140;

export function commentPreview(task, aliases) {
  const comments = Array.isArray(task?.comments) ? task.comments : [];
  const last = comments[comments.length - 1];
  if (!last) return null;
  const text = String(last.text || "");
  return {
    id: last.id,
    ts: last.ts,
    by: last.by || null,
    text: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text,
    mentions: Array.isArray(last.mentions) ? [...last.mentions] : [],
    mentions_owner: commentAddressesOwner(last, aliases),
  };
}

/**
 * Is the thread waiting on the owner?
 *
 * The NEWEST comment has to be the one naming them, and it has to be somebody
 * else's. Scanning the whole thread instead would leave "Requiere tu respuesta"
 * up forever on any task where an agent once said "@Manu?" — the owner answers,
 * and the badge stays, which teaches people to ignore it. Answering IS the way
 * this clears, so the newest comment is the only one that can raise it.
 */
export function awaitsOwner(task, aliases) {
  const comments = Array.isArray(task?.comments) ? task.comments : [];
  return commentAddressesOwner(comments[comments.length - 1], aliases);
}

/**
 * Is this task stuck ON THE OWNER — "trabada por mí"?
 *
 * Open, sitting in the blocked column, and assigned to the human. All three,
 * because `blocked` alone says "waiting on somebody" and most of the time that
 * somebody is an agent or a third party — demoting those to the bottom of the
 * list would bury work that is actually moving.
 *
 * This is what sinks a row in the task list AND what raises it in the
 * notification centre, which is not a contradiction: it is not news, so it does
 * not belong at the top of a list sorted by news; it is owed, so it belongs in
 * the one place that collects what you owe.
 */
export function blockedByOwner(task) {
  return task?.state === "open"
    && task?.status === BLOCKED_STATUS
    && (task?.agent || null) === OWNER_ACTOR_ID;
}
