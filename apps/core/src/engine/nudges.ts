// The interruption budget: the one gate every message APX sends the owner unasked goes through (routine news, the
// reminders they set). Anchors always arrive; another agent's news waits for the super-agent's team news while a
// relay routine runs (one voice, a few times a day); in quiet hours the rest waits and goes together when they end;
// past the day's cap, too soon after another about the same project or of the same kind, or of a kind the owner keeps
// marking 👎, it stays in the tray only. Answers to the owner's own messages never come here.

import type { Nudge } from "@apx/protocol";
import { inQuietHours, noticePrefs, quietEnd } from "../domain/notices.ts";
import { nudgeId } from "../domain/nudges.ts";
import type { Store } from "../domain/store.ts";
import { untrusted } from "../tools/result.ts";
import { audienceOf } from "./audience.ts";

/** How far back the owner's 👍/👎 count, and how many 👎 (with no later 👍) mute a kind. */
const RATING_DAYS = 14;
const MUTE_AFTER = 2;

/** A routine's or an agent's news is rated (an anchor too: its rating shapes it, never mutes it); reminders are not. */
export const rateable = (kind: string) => kind.startsWith("routine:") || kind.startsWith("agent:");

const ratingsSince = (at: Date) => new Date(at.getTime() - RATING_DAYS * 86_400_000).toISOString();

/** A kind the owner marked 👎 at least twice lately, the latest rating a 👎. */
export function muted(store: Store, kind: string, at: Date): boolean {
  const r = store.nudges.ratings(kind, ratingsSince(at));
  return r.down >= MUTE_AFTER && r.last === "down";
}

/** What a routine's turn is told about how the owner rated its earlier messages; empty when they never did. */
export function ratingNote(store: Store, kind: string, at = new Date()): string {
  const r = store.nudges.ratings(kind, ratingsSince(at));
  if (!r.up && !r.down) return "";
  const last = r.last === "down" ? "not useful" : "useful";
  return `In the last ${RATING_DAYS} days the owner marked ${r.up} of these messages useful and ${r.down} not useful (the latest: ${last}).${r.last === "down" ? " Be shorter and say only what changed; if nothing did, say so in one line." : ""}`;
}

/** How many of the messages sent meanwhile a turn sees, and how much of each. */
const MEANWHILE_MAX = 3;
const MEANWHILE_CHARS = 600;
/** With no earlier turn in the chat, how far back "meanwhile" goes. */
const MEANWHILE_FIRST_MS = 12 * 3600_000;

/**
 * What APX sent the owner unasked since this chat's previous turn (routine news, the team news): they answer it on
 * the same channel, so the turn must know what they are answering. Agents' words, so outside data.
 */
export function sentMeanwhile(store: Store, threadId: string, runId: string, at = new Date()): string | undefined {
  const previous = store.runs.list(threadId, 2).find((r) => r.id !== runId);
  const since = previous?.started_at ?? new Date(at.getTime() - MEANWHILE_FIRST_MS).toISOString();
  const sent = store.nudges
    .sentSince(since, MEANWHILE_MAX)
    .map((n) =>
      untrusted("sent_to_owner", { what: n.kind.replace(/^routine:/, ""), at: n.at }, n.text.slice(0, MEANWHILE_CHARS)),
    );
  // A question or an OK another chat sent to the owner's channel: what they may be answering here, and where it is.
  const to = store.threads.context(threadId).reply_to;
  const fromChats = to
    ? store.channels.outbox
        .sentFromOthers(to.channel, to.conversation, threadId, since, MEANWHILE_MAX)
        // Only the owner's own chats: what a contact's chat sent carries words (a name) the owner never wrote.
        .filter((o) => {
          const chat = store.threads.get(o.thread_id ?? "");
          return Boolean(chat && audienceOf(store, chat).kind === "owner");
        })
        .map((o) =>
          untrusted(
            "sent_to_owner",
            {
              from_chat: o.thread_id ?? "",
              chat_title: store.threads.get(o.thread_id ?? "")?.title.slice(0, 80) ?? "",
              at: o.created_at ?? "",
            },
            (o.text ?? "").slice(0, MEANWHILE_CHARS),
          ),
        )
    : [];
  const all = [...sent, ...fromChats];
  if (!all.length) return undefined;
  return `${all.join("\n")}${fromChats.length ? `\n${FROM_CHATS_NOTE}` : ""}`;
}

/** Said beside what other chats sent: the owner may be answering one of them here. */
const FROM_CHATS_NOTE =
  "Some of these came from other chats (from_chat). If the owner is answering one, act on it there: read it with read_chat, and pass their answer to that chat's agent with delegate.";

export type Offer = {
  /** What it is about, for the per-kind gap: "routine:<name>", "reminder"… */
  kind: string;
  text: string;
  thread_id?: string | undefined;
  project_id?: string | undefined;
  /** It always arrives and is not counted (a morning brief the owner made an anchor). */
  anchor?: boolean | undefined;
  /** The owner asked for it at this time (a reminder they set): not counted, but it waits out quiet hours. */
  asked?: boolean | undefined;
  critical?: boolean | undefined;
  /** Another agent's (not the super-agent's): told in the team news when a relay routine runs. */
  relay?: boolean | undefined;
};

/** A relay routine is on: the super-agent tells the owner the other agents' news, in one message. */
export const relaying = (store: Store) => store.routines.list().some((r) => r.enabled && r.action === "relay");

export function createNudges(deps: {
  store: Store;
  /** Puts it on the owner's channel; false when there is none to put it on. `rate` names one to rate (👍/👎). */
  send: (text: string, threadId: string | undefined, rate?: string) => boolean;
  /** "While you were away: …" for what waited out the quiet hours. */
  digest: (texts: string[]) => string;
  now?: () => Date;
}) {
  const { store } = deps;
  const clock = deps.now ?? (() => new Date());

  function deliver(o: Offer, exempt: boolean, reason?: string): Nudge["state"] {
    const id = nudgeId();
    const rate = rateable(o.kind) ? id : undefined;
    const state = deps.send(o.text, o.thread_id, rate) ? "sent" : "no_channel";
    store.nudges.add({ id, ...strip(o), at: clock().toISOString(), state, exempt, ...(reason ? { reason } : {}) });
    return state;
  }

  /** Cap and gaps, for something that may go now. */
  function pass(o: Offer, at: Date): Nudge["state"] {
    const prefs = noticePrefs(store);
    if (o.asked) return deliver(o, true);
    if (o.critical && prefs.critical_skips_budget) return deliver(o, true, "critical");
    const dayStart = new Date(at);
    dayStart.setHours(0, 0, 0, 0);
    const drop = (reason: string) => {
      store.nudges.add({ ...strip(o), at: at.toISOString(), state: "dropped", reason, exempt: false });
      return "dropped" as const;
    };
    if (muted(store, o.kind, at)) return drop("you marked this kind unhelpful");
    if (prefs.budget_per_day > 0 && store.nudges.countedSince(dayStart.toISOString()) >= prefs.budget_per_day)
      return drop("daily cap reached");
    const within = (last: string | undefined, min: number) =>
      min > 0 && last !== undefined && at.getTime() - Date.parse(last) < min * 60_000;
    if (o.project_id && within(store.nudges.lastSent({ project_id: o.project_id }), prefs.project_gap_min))
      return drop("too soon after another about this project");
    if (within(store.nudges.lastSent({ kind: o.kind }), prefs.kind_gap_min))
      return drop("too soon after another of this kind");
    return deliver(o, false);
  }

  return {
    offer(o: Offer): Nudge["state"] {
      const at = clock();
      if (o.anchor) return deliver(o, true, "anchor");
      if (o.relay && !o.critical && relaying(store)) {
        const unhelpful = muted(store, o.kind, at);
        store.nudges.add({
          ...strip(o),
          at: at.toISOString(),
          state: unhelpful ? "dropped" : "relay",
          reason: unhelpful ? "you marked this kind unhelpful" : "for the team news",
          exempt: false,
        });
        return unhelpful ? "dropped" : "relay";
      }
      const prefs = noticePrefs(store);
      if (inQuietHours(prefs, at) && !(o.critical && prefs.critical_wakes)) {
        store.nudges.add({
          ...strip(o),
          at: at.toISOString(),
          state: "held",
          reason: "quiet hours",
          // Whether it would skip the cap once the window ends.
          exempt: Boolean(o.asked || (o.critical && prefs.critical_skips_budget)),
          hold_until: quietEnd(prefs, at).toISOString(),
        });
        return "held";
      }
      return pass(o, at);
    },
    /** Each tick: what waited out the quiet hours goes now, together in one message when there are several. */
    release(): void {
      const at = clock();
      const held = store.nudges.heldUntil(at.toISOString());
      const [first] = held;
      if (!first) return;
      const asked = held.every((n) => n.exempt);
      const state = pass(
        held.length === 1
          ? { kind: first.kind, text: first.text, thread_id: first.thread_id, project_id: first.project_id, asked }
          : { kind: "digest", text: deps.digest(held.map((n) => n.text)), thread_id: first.thread_id, asked },
        at,
      );
      store.nudges.settle(
        held.map((n) => n.id),
        state === "dropped" ? "dropped" : "merged",
        "when the quiet hours ended",
      );
    },
    /** Today's count against the cap. */
    today(): { sent: number; cap: number } {
      const dayStart = new Date(clock());
      dayStart.setHours(0, 0, 0, 0);
      return { sent: store.nudges.countedSince(dayStart.toISOString()), cap: noticePrefs(store).budget_per_day };
    },
  };
}

const strip = (o: Offer) => ({
  kind: o.kind,
  text: o.text,
  ...(o.thread_id ? { thread_id: o.thread_id } : {}),
  ...(o.project_id ? { project_id: o.project_id } : {}),
});

export type Nudges = ReturnType<typeof createNudges>;
