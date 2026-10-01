import fs from "node:fs";
import path from "node:path";
import type { Author } from "@apx/protocol";
import { publicInput } from "../domain/inputs.ts";
import { publicRun } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import type { Admit, Engine } from "../engine/engine.ts";
import type { Upkeep } from "../engine/upkeep.ts";
import { badRequest, notFound } from "../errors.ts";
import { isInside } from "../paths.ts";
import type { CallContext } from "./context.ts";

type SendMode = "queue" | "interrupt" | "steer";
type ChannelSender = NonNullable<CallContext["channel"]>;

import type { Handlers } from "./router.ts";

/**
 * A code thread's folder: inside its project's folder on disk, symlinks resolved, so the agent cannot be pointed
 * outside the project.
 */
function codeFolder(store: Store, projectId: string | undefined, cwd: string | undefined): string {
  const project = projectId ? store.projects.get(projectId) : undefined;
  if (!project?.path || !project.present) throw badRequest("a code thread needs a project whose folder is on disk");
  let root: string;
  let dir: string;
  try {
    root = fs.realpathSync(project.path);
    dir = fs.realpathSync(path.resolve(root, cwd ?? "."));
  } catch {
    throw badRequest(`no folder ${cwd ?? project.path}`);
  }
  if (!isInside(root, dir)) throw badRequest(`${cwd} is outside the project's folder`);
  return dir;
}

export function threadHandlers(store: Store, engine: Engine, upkeep: Pick<Upkeep, "compact">) {
  const threadAgent = (threadId: string) => {
    const thread = store.threads.get(threadId);
    if (!thread) throw notFound(`thread ${threadId}`);
    const agent = store.agents.get(thread.agent_ids[0] ?? "");
    if (!agent) throw notFound(`agent of thread ${threadId}`);
    return { thread, agent };
  };

  /** Words into a thread: the message, the preview, then the running turn (steer) or a new run. */
  function post(
    threadId: string,
    text: string,
    author: Author,
    steer: boolean,
    admit: Omit<Admit, "thread_id" | "text">,
  ) {
    return store.tx(() => {
      const message = store.messages.add({ thread_id: threadId, author, parts: [{ type: "text", text }] });
      store.threads.patch(threadId, { preview: previewOf(text) });
      const into = steer ? engine.steer(threadId, text) : undefined;
      if (into) return { message, run: publicRun(into), steered: true };
      return { message, run: publicRun(engine.admit({ ...admit, thread_id: threadId, text })) };
    });
  }

  /** A message that arrived on a channel: the owner's own words, or a contact's (a third party's). */
  function channelSend(threadId: string, agentId: string, text: string, mode: SendMode, ch: ChannelSender) {
    const owner = ch.role === "owner";
    if (owner && mode === "interrupt") engine.interrupt(threadId);
    // Answers go back where this message came from, until the owner writes somewhere else.
    store.threads.mergeContext(threadId, { reply_to: { channel: ch.id, conversation: ch.conversation } });
    return post(
      threadId,
      text,
      owner ? { kind: "user" } : { kind: "person", id: ch.person_id, name: ch.name, channel: ch.id },
      owner && mode === "steer",
      {
        agent_id: agentId,
        trigger: "channel",
        origin: {
          kind: "channel",
          channel: ch.id,
          conversation: ch.conversation,
          person_id: ch.person_id,
          name: ch.name,
          role: ch.role,
        },
      },
    );
  }

  return {
    "threads.list": ({ project_id, include_subthreads }) => ({
      threads: store.threads.list({ project_id, include_subthreads }),
    }),
    "threads.get": ({ thread }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      return { thread: t, messages: store.messages.list(thread), runs: store.runs.list(thread).map(publicRun) };
    },
    "threads.create": ({ kind, agent_id, title, project_id, cwd, write }) => {
      const agent = store.agents.get(agent_id);
      if (!agent) throw notFound(`agent ${agent_id}`);
      const pid = project_id ?? agent.project_id;
      const folder = kind === "code" ? codeFolder(store, pid, cwd) : undefined;
      return store.threads.create({
        kind,
        title: title ?? (folder ? `${agent.name} · ${path.basename(folder)}` : agent.name),
        agent_ids: [agent.id],
        project_id: pid,
        ...(folder ? { cwd: folder, write: write ?? "ask" } : {}),
      });
    },
    "threads.send": ({ thread, text, mode }, ctx) => {
      const { agent } = threadAgent(thread);
      if (ctx.channel) return channelSend(thread, agent.id, text, mode, ctx.channel);
      if (mode === "interrupt") engine.interrupt(thread);
      // A model-driven client (another tool's agent) is not the owner: its text arrives as untrusted data, and it
      // never steers a running turn.
      if (ctx.actor === "agent")
        return post(thread, text, { kind: "system" }, false, {
          agent_id: agent.id,
          trigger: "channel",
          origin: { kind: "agent", id: "external", name: "an external agent client", thread_id: thread, run_id: "" },
        });
      // The owner writing in the app: answers stay in the app (not on the channel the last message came from).
      store.threads.mergeContext(thread, { reply_to: undefined });
      return post(thread, text, { kind: "user" }, mode === "steer", {
        agent_id: agent.id,
        trigger: "user",
        origin: { kind: "user" },
      });
    },
    "threads.cancel": ({ thread }) => ({ canceled: engine.cancel(thread) }),
    "threads.compact": async ({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      return upkeep.compact(thread);
    },
    "threads.read": ({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      store.threads.patch(thread, { unread: 0 }, false);
      return { ok: true as const };
    },
    "runs.pending": ({ thread }) => ({ inputs: engine.pending(thread) }),
    "runs.respond": ({ input, decision, text }) => publicInput(engine.respond(input, { decision, text })),
    "runs.get": ({ run }) => {
      const r = store.runs.get(run);
      if (!r) throw notFound(`run ${run}`);
      return publicRun(r);
    },
    "runs.wait": async ({ run, timeout_s }) => {
      const r = await engine.wait(run, timeout_s * 1000);
      if (!r) throw notFound(`run ${run}`);
      return publicRun(r);
    },
    /** A widget's sendPrompt(): an input on the thread that owns the widget, marked as coming from it. */
    "surfaces.prompt": ({ surface, text }) => {
      const s = store.surfaces.get(surface);
      if (!s) throw notFound(`surface ${surface}`);
      const threadId = s.thread_id ?? HOME_THREAD_ID;
      const { agent } = threadAgent(threadId);
      return store.tx(() => {
        store.messages.add({
          thread_id: threadId,
          author: { kind: "surface", id: s.id, title: s.title },
          parts: [{ type: "text", text }],
        });
        const run = engine.admit({
          thread_id: threadId,
          agent_id: agent.id,
          trigger: "surface",
          origin: { kind: "surface", id: s.id, title: s.title },
          text,
        });
        return { thread: threadId, run: publicRun(run) };
      });
    },
  } satisfies Partial<Handlers>;
}
