// The owner's arrangement of chats (rename, pin, archive, work in the project's folder) and deleting one. Home is
// where the super-agent lives: renamed and pinned, never archived or deleted. A task's chat belongs to its task.
import fs from "node:fs";
import path from "node:path";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { isInside } from "../paths.ts";
import type { Handlers } from "./router.ts";
import { codeFolder } from "./threads.ts";

export function threadAdminHandlers(store: Store, home: string) {
  const isHome = (id: string, kind: string) => id === HOME_THREAD_ID || kind === "home";

  return {
    "threads.update": ({ thread, title, pinned, archived, write }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      if (archived && isHome(t.id, t.kind)) throw badRequest("Home cannot be archived");
      if (write !== undefined) {
        if (!["loose", "agent", "code"].includes(t.kind)) throw badRequest("only a chat of yours can work in a folder");
        if (write === null && t.kind === "code") throw badRequest("a code session always works in its folder");
        store.threads.workIn(
          thread,
          write ? { cwd: t.cwd ?? codeFolder(store, t.project_id, undefined), write } : null,
        );
      }
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
