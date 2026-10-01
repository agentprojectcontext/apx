// How the office's clock reaches the owner: a routine's news and a due commitment go to the attention tray and to
// the owner's channel, in the owner's language.
import { channelTexts } from "./channels/texts.ts";
import type { Store } from "./domain/store.ts";
import { previewOf } from "./domain/threads.ts";
import type { Attention } from "./engine/attention.ts";
import type { AdmitFn } from "./engine/engine.ts";
import { createScheduler } from "./engine/routines.ts";
import type { Log } from "./log.ts";

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
      for (const t of store.tasks.remindDue(at.toISOString())) {
        const person = t.person_id ? store.persons.get(t.person_id)?.name : undefined;
        const text = channelTexts(store).due(t.title, person, t.owed_by);
        attention.add({ kind: "due", level: "warn", title: t.title, body: text, thread_id: t.thread_id, ref: t.id });
        deps.notifyOwner(text, t.thread_id);
      }
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
