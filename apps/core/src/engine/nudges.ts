// The interruption budget: the one gate every message APX sends the owner unasked goes through (routine news, the
// reminders they set). Anchors always arrive; in quiet hours the rest waits and goes together when they end; past the
// day's cap, or too soon after another about the same project or of the same kind, it stays in the tray only. Answers
// to the owner's own messages never come here.
import type { Nudge } from "@apx/protocol";
import { inQuietHours, noticePrefs, quietEnd } from "../domain/notices.ts";
import type { Store } from "../domain/store.ts";

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
};

export function createNudges(deps: {
  store: Store;
  /** Puts it on the owner's channel; false when there is none to put it on. */
  send: (text: string, threadId: string | undefined) => boolean;
  /** "While you were away: …" for what waited out the quiet hours. */
  digest: (texts: string[]) => string;
  now?: () => Date;
}) {
  const { store } = deps;
  const clock = deps.now ?? (() => new Date());

  function deliver(o: Offer, exempt: boolean, reason?: string): Nudge["state"] {
    const state = deps.send(o.text, o.thread_id) ? "sent" : "no_channel";
    store.nudges.add({ ...strip(o), at: clock().toISOString(), state, exempt, ...(reason ? { reason } : {}) });
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
