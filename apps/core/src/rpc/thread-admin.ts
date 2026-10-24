// The owner's arrangement of chats (rename, pin, archive, work in the project's folder) and deleting one. Home is
// where the super-agent lives: renamed and pinned, never archived or deleted. A task's chat belongs to its task.
// Forking copies a chat up to a message into a new one.
import fs from "node:fs";
import path from "node:path";
import type { Message } from "@apx/protocol";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { isInside } from "../paths.ts";
import type { Handlers } from "./router.ts";
import { codeFolder } from "./threads.ts";

const textOf = (m: Message) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");

/** The media and job logs deleted threads leave on disk; only files under the home (a row never points elsewhere). */
export function removeThreadFiles(home: string, files: { media: string[]; jobs: string[] }): void {
  const owned = [...files.media, ...files.jobs.map((id) => path.join(home, "jobs", `${id}.log`))];
  for (const file of owned) if (isInside(home, file)) fs.rmSync(file, { force: true });
}

export function threadAdminHandlers(store: Store, home: string, beforeDelete?: (ids: string[]) => Promise<void>) {
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
    "threads.delete": async ({ thread }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      if (isHome(t.id, t.kind)) throw badRequest("Home cannot be deleted");
      if (store.tasks.byThread(t.id)) throw badRequest("this chat belongs to a task: delete the task");
      const ids = store.threads.family(t.id);
      // Refused rather than canceled: a turn half-way through a tool may still be changing things.
      if (store.threads.busy(ids)) throw conflict("something is running in this chat: stop it first");
      await beforeDelete?.(ids);
      const files = store.tx(() => {
        store.notifications.dropThreads(ids);
        return store.threads.remove(ids);
      });
      removeThreadFiles(home, files);
      return { deleted: ids };
    },
    "threads.fork": ({ thread, message, title }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      if (t.engine) throw conflict("an engine session keeps its own history: it cannot be forked");
      if (t.agent_ids.length !== 1) throw badRequest("a chat of several agents cannot be forked");
      if (store.threads.busy([thread])) throw conflict("a turn is running in this chat: stop it first");
      const list = store.messages.list(thread, 100_000);
      const at = list.find((m) => m.id === message);
      if (!at) throw notFound(`message ${message} in this chat`);
      // An answer goes whole; the owner's message stays out and comes back as a draft.
      const own = at.author.kind === "user";
      const kept = list.filter((m) =>
        own ? m.seq < at.seq : m.seq <= at.seq || (at.run_id !== undefined && m.run_id === at.run_id),
      );
      const keptRuns = new Set(kept.flatMap((m) => (m.run_id ? [m.run_id] : [])));
      const firstOut = list.find((m) => !kept.includes(m));
      // What the model saw ends where the first left-out turn starts, runs that wrote nothing too.
      const outRuns = firstOut
        ? store.runs
            .list(thread, 100_000)
            .filter((r) => !keptRuns.has(r.id) && r.started_at >= firstOut.created_at)
            .map((r) => r.id)
        : [];
      const cut = store.modelLog.firstOf(thread, outRuns);
      const context = store.threads.context(thread);
      return store.tx(() => {
        const fork = store.threads.create({
          kind: t.kind === "code" || t.kind === "loose" ? t.kind : "agent",
          title: title || t.title,
          agent_ids: t.agent_ids,
          project_id: t.project_id,
          cwd: t.cwd,
          write: t.write,
        });
        store.messages.copyInto(fork.id, kept);
        store.modelLog.copyInto(thread, fork.id, cut);
        const family = context.memory_family ?? t.id;
        store.threads.mergeContext(thread, { memory_family: family });
        store.threads.mergeContext(fork.id, {
          memory_family: family,
          memory_cutoff: [context.memory_cutoff, kept.at(-1)?.created_at ?? t.created_at]
            .filter((at): at is string => !!at)
            .sort()[0],
          titled: true,
          model_choice: context.model_choice,
          compaction:
            context.compaction && (cut === undefined || context.compaction.upto < cut) ? context.compaction : undefined,
        });
        const last = kept.at(-1);
        if (last) store.threads.settle(fork.id, last.created_at, previewOf(textOf(last)));
        const draft = own ? textOf(at) : undefined;
        return { thread: store.threads.get(fork.id) ?? fork, ...(draft ? { draft } : {}) };
      });
    },
  } satisfies Partial<Handlers>;
}
