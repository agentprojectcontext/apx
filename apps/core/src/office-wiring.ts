// How the office's clock reaches the owner: a routine's news and the reminders the owner asked for go to the attention
// tray and, through the interruption budget (engine/nudges.ts), to the owner's channel, in the owner's language. A due
// date passing only lands in the tray: the watch routine mentions overdue work in one line, never a message per task.
// The same clock picks up, hourly, assigned tasks whose work never started, and revives tasks whose work stopped with
// nobody on it (engine/task-stall.ts), and hands the owner's task comments that named no one to an agent
// (engine/task-inbox.ts), and answers the contacts who wrote outside a channel's attention hours once they begin
// (channels/held.ts). A provider limit that stops the agents is told once per stall.
import { channelTexts } from "./channels/texts.ts";
import type { Presentation } from "./domain/channels.ts";
import { ownerTimeZone } from "./domain/owner.ts";
import type { Store } from "./domain/store.ts";
import { previewOf } from "./domain/threads.ts";
import type { Attention } from "./engine/attention.ts";
import type { AdmitFn } from "./engine/engine.ts";
import { createNudges } from "./engine/nudges.ts";
import { createStallNotices, resetLabel } from "./engine/provider-limit.ts";
import { createScheduler } from "./engine/routines.ts";
import { handOwnerComments } from "./engine/task-inbox.ts";
import { reviveStalled } from "./engine/task-stall.ts";
import { PICKUP_EVERY_MS, pickUpTasks, startScheduled } from "./engine/task-work.ts";
import type { Log } from "./log.ts";

/** A reminder noticed this late goes only to the tray: a message about it now would be noise. */
const LATE_MS = 3 * 3600_000;
/** How often tasks whose work stopped are looked for. */
const STALL_CHECK_EVERY_MS = 10 * 60_000;

export function officeScheduler(deps: {
  store: Store;
  admit: AdmitFn;
  attention: Attention;
  /** Puts a message on the owner's channel; false when there is none. */
  notifyOwner: (body: Presentation, threadId: string | undefined) => boolean;
  /** Answers contacts' chats whose channel's attention hours began; how many it started. */
  openHeld?: () => number;
  log: Log;
  now?: () => Date;
}) {
  const { store, attention } = deps;
  const nudges = createNudges({
    store,
    send: (text, threadId, rate) => deps.notifyOwner({ text, ...(rate ? { rate } : {}) }, threadId),
    digest: (texts) => channelTexts(store).digest(texts),
    ...(deps.now ? { now: deps.now } : {}),
  });
  let pickedAt = Number.NEGATIVE_INFINITY;
  let stallsAt = Number.NEGATIVE_INFINITY;
  const scheduler = createScheduler({
    store,
    admit: deps.admit,
    log: deps.log,
    ...(deps.now ? { now: deps.now } : {}),
    eachTick: (at) => {
      // Assigned tasks that never started are picked up once an hour.
      if (at.getTime() - pickedAt >= PICKUP_EVERY_MS) {
        pickedAt = at.getTime();
        pickUpTasks(store, deps.admit);
      }
      handOwnerComments(store, deps.admit, at);
      // A task given a start time begins then, not at the next hourly pickup.
      startScheduled(store, deps.admit, at);
      if (at.getTime() - stallsAt >= STALL_CHECK_EVERY_MS) {
        stallsAt = at.getTime();
        const { revived, told } = reviveStalled(store, deps.admit, at);
        if (revived || told) deps.log.info({ revived, told }, "stalled tasks");
      }
      const texts = channelTexts(store);
      const asked: Array<{ text: string; thread_id: string }> = [];
      for (const t of store.tasks.remindDue(at.toISOString())) {
        const person = t.person_id ? store.persons.get(t.person_id)?.name : undefined;
        const text = texts.due(t.title, person, t.owed_by);
        attention.add({ kind: "due", level: "warn", title: t.title, body: text, thread_id: t.thread_id, ref: t.id });
        // Only a reminder time the owner set, and not one noticed hours late (an import, the core off for a while).
        if (t.remind_at && at.getTime() - Date.parse(t.remind_at) <= LATE_MS)
          asked.push({ text, thread_id: t.thread_id });
      }
      const [first] = asked;
      if (first)
        nudges.offer({
          kind: "reminder",
          text: asked.length === 1 ? first.text : texts.reminders(asked.map((a) => a.text)),
          thread_id: first.thread_id,
          asked: true,
        });
      nudges.release();
      deps.openHeld?.();
    },
    deliver: ({ routine, run, text, failed }) => {
      const texts = channelTexts(store);
      // The agent's words as they are, with no title (v1 never added one): the chat in the app says which routine.
      const body = failed ? texts.routineFailed(routine.name, text.slice(0, 300)) : text;
      nudges.offer({
        kind: `routine:${routine.name}`,
        text: body,
        thread_id: run.thread_id,
        project_id: routine.project_id,
        anchor: routine.anchor,
        // The team news comes as often as the owner set it and carries everyone's news: past the cap, it would be lost.
        asked: routine.action === "relay",
        relay: store.agents.get(routine.agent_id)?.kind !== "secretary",
      });
      attention.add({
        kind: "routine",
        level: failed ? "error" : "info",
        title: routine.name,
        body: previewOf(failed ? body : text),
        thread_id: run.thread_id,
        ref: run.id,
      });
    },
  });
  // A provider limit that stopped the agents: one notice per stall, like an agent's news (tray and budget).
  const stalls = createStallNotices({
    notify: (run) => {
      const texts = channelTexts(store);
      const text = texts.providerLimit(run.resets_at && resetLabel(run.resets_at, ownerTimeZone(store)));
      attention.add({ kind: "agent", level: "warn", title: texts.providerLimitTitle, body: text });
      nudges.offer({ kind: "provider-limit", text });
    },
    ...(deps.now ? { now: deps.now } : {}),
  });
  return Object.assign(scheduler, { nudges, stalls });
}
