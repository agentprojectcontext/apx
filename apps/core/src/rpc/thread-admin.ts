// The owner's arrangement of chats (rename, pin, archive) and deleting one. Home is where the super-agent lives:
// it can be renamed and pinned, never archived or deleted. A task's chat belongs to its task.
import fs from "node:fs";
import path from "node:path";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { isInside } from "../paths.ts";
import type { Handlers } from "./router.ts";

export function threadAdminHandlers(store: Store, home: string) {
  const isHome = (id: string, kind: string) => id === HOME_THREAD_ID || kind === "home";

  return {
    "threads.update": ({ thread, title, pinned, archived }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      if (archived && isHome(t.id, t.kind)) throw badRequest("Home cannot be archived");
      return store.threads.arrange(thread, {
        ...(title !== undefined ? { custom_title: title || null } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
        ...(archived !== undefined ? { archived } : {}),
      });
    },
    "threads.delete": ({ thread }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      if (isHome(t.id, t.kind)) throw badRequest("Home cannot be deleted");
      if (store.tasks.byThread(t.id)) throw badRequest("this chat belongs to a task: delete the task");
      const ids = store.threads.family(t.id);
      // Refused rather than canceled: a turn half-way through a tool may still be changing things.
      if (store.threads.busy(ids)) throw conflict("something is running in this chat: stop it first");
      const files = store.tx(() => {
        store.notifications.dropThreads(ids);
        return store.threads.remove(ids);
      });
      const owned = [...files.media, ...files.jobs.map((id) => path.join(home, "jobs", `${id}.log`))];
      // Only files under the home: a row never sends a delete elsewhere on disk.
      for (const file of owned) if (isInside(home, file)) fs.rmSync(file, { force: true });
      return { deleted: ids };
    },
  } satisfies Partial<Handlers>;
}
