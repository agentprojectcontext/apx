// How the office's clock reaches the owner: a routine's news and the reminders the owner asked for go to the attention
// tray and to the owner's channel, in the owner's language. A due date passing only lands in the tray: the watch
// routine mentions overdue work in one line, never a message per task.
import { channelTexts } from "./channels/texts.ts";
import type { Store } from "./domain/store.ts";
import { previewOf } from "./domain/threads.ts";
import type { Attention } from "./engine/attention.ts";
import type { AdmitFn } from "./engine/engine.ts";
import { createScheduler } from "./engine/routines.ts";
import type { Log } from "./log.ts";

/** A reminder noticed this late goes only to the tray: a message about it now would be noise. */
const LATE_MS = 3 * 3600_000;

export function officeScheduler(deps: {
  store: Store;
  admit: AdmitFn;
  attention: Attention;
  notifyOwner: (text: string, threadId: string) => void;
  log: Log;
  now?: () => Date;
}) {
  const { store, attention } = deps;
  return createScheduler({
    store,
    admit: deps.admit,
    log: deps.log,
    ...(deps.now ? { now: deps.now } : {}),
    eachTick: (at) => {
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
        deps.notifyOwner(asked.length === 1 ? first.text : texts.reminders(asked.map((a) => a.text)), first.thread_id);
    },
    deliver: ({ routine, run, text, failed }) => {
      const texts = channelTexts(store);
      const body = failed ? texts.routineFailed(routine.name, text.slice(0, 300)) : texts.routine(routine.name, text);
      deps.notifyOwner(body, run.thread_id);
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
}
