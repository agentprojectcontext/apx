import fs from "node:fs";
import path from "node:path";
import type { Author } from "@apx/protocol";
import { OWNER_ID } from "../domain/persons.ts";
import { type Attachment, publicRun } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import type { Admit, Engine } from "../engine/engine.ts";
import type { Upkeep } from "../engine/upkeep.ts";
import { badRequest, conflict, notFound, unauthorized } from "../errors.ts";
import { isInside } from "../paths.ts";
import type { CallContext } from "./context.ts";

type SendMode = "queue" | "interrupt" | "steer";
type ChannelSender = NonNullable<CallContext["channel"]>;
type CreateParams = Parameters<Handlers["threads.create"]>[0];

import type { Handlers } from "./router.ts";

/**
 * A code thread's folder: inside its project's folder on disk, symlinks resolved, so the agent cannot be pointed
 * outside the project.
 */
export function codeFolder(store: Store, projectId: string | undefined, cwd: string | undefined): string {
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

/** A new chat or code thread. An outside app gets a plain chat, named after it, that only it can use. */
function createThread(
  store: Store,
  { kind, agent_id, title, project_id, cwd, write, engine }: CreateParams,
  ctx: CallContext,
) {
  const agent = store.agents.get(agent_id);
  if (!agent) throw notFound(`agent ${agent_id}`);
  const pid = project_id ?? agent.project_id;
  if (ctx.client) {
    const own = ctx.client.id;
    return store.tx(() => {
      const t = store.threads.create({
        kind: "loose",
        title: `${ctx.client?.name}: ${title ?? agent.name}`.slice(0, 120),
        agent_ids: [agent.id],
        project_id: pid,
      });
      store.threads.mergeContext(t.id, { client: own });
      return t;
    });
  }
  if (engine && kind !== "code") throw badRequest("an engine session is a code thread: it works in a folder");
  const folder = kind === "code" ? codeFolder(store, pid, cwd) : undefined;
  return store.tx(() => {
    const t = store.threads.create({
      kind,
      title: title ?? (folder ? `${engine ?? agent.name} · ${path.basename(folder)}` : agent.name),
      agent_ids: [agent.id],
      project_id: pid,
      ...(folder ? { cwd: folder, write: write ?? "ask" } : {}),
      ...(engine ? { engine } : {}),
    });
    // The engine is the session: it always runs it, never the router.
    if (engine) store.threads.mergeContext(t.id, { model_choice: { model: engine, router: false } });
    return engine ? (store.threads.get(t.id) ?? t) : t;
  });
}

/** The owner's attachments as a run keeps them: files uploaded to this chat (or to none) that exist, each once. */
function attachedFiles(store: Store, thread: string, ids: string[]): Attachment[] {
  return [...new Set(ids)].map((id) => {
    const m = store.media.get(id);
    // Not media APX made (it has a service) nor another chat's upload.
    if (!m || m.service || (m.thread_id && m.thread_id !== thread)) throw badRequest(`no attachment ${id}`);
    return { media_id: m.id, kind: m.kind, mime: m.mime, name: m.prompt ?? m.id };
  });
}

export function threadHandlers(store: Store, engine: Engine, upkeep: Pick<Upkeep, "compact">) {
  const threadAgent = (threadId: string) => {
    const thread = store.threads.get(threadId);
    if (!thread) throw notFound(`thread ${threadId}`);
    const agent = store.agents.get(thread.agent_ids[0] ?? "");
    if (!agent) throw notFound(`agent of thread ${threadId}`);
    return { thread, agent };
  };

  /** An outside app reads and writes only in the chats it started. */
  function ownClientThread(threadId: string, ctx: CallContext): void {
    if (ctx.client && store.threads.context(threadId).client !== ctx.client.id)
      throw unauthorized(`${ctx.client.name} can only use the chats it started`);
  }

  /** Words into a thread: the message, the preview, then the running turn (steer) or a new run. */
  function post(
    threadId: string,
    text: string,
    author: Author,
    steer: boolean,
    admit: Omit<Admit, "thread_id" | "text">,
  ) {
    const files = admit.attachments ?? [];
    return store.tx(() => {
      const message = store.messages.add({
        thread_id: threadId,
        author,
        parts: [
          { type: "text", text },
          ...files.map((f) =>
            f.kind === "image"
              ? ({ type: "image", media_id: f.media_id, mime: f.mime, alt: f.name } as const)
              : f.kind === "audio"
                ? ({ type: "audio", media_id: f.media_id, mime: f.mime } as const)
                : ({
                    type: "file",
                    media_id: f.media_id,
                    name: f.name,
                    mime: f.mime,
                    bytes: store.media.get(f.media_id)?.bytes ?? 0,
                  } as const),
          ),
        ],
      });
      store.threads.patch(threadId, { preview: previewOf(text) });
      // Attachments need a turn of their own: a steer only carries words.
      const into = steer && !files.length ? engine.steer(threadId, text) : undefined;
      if (into) {
        store.runs.setReplyTo(into.id, store.threads.context(threadId).reply_to);
        return { message, run: publicRun(into), steered: true };
      }
      return { message, run: publicRun(engine.admit({ ...admit, thread_id: threadId, text })) };
    });
  }

  /** A message that arrived on a channel: the owner's own words, or a contact's (a third party's). */
  function channelSend(
    threadId: string,
    agentId: string,
    text: string,
    mode: SendMode,
    ch: ChannelSender,
    files: Attachment[],
  ) {
    const owner = ch.role === "owner";
    if (owner && mode === "interrupt") engine.interrupt(threadId);
    // Answers go back where this message came from, until the owner writes somewhere else.
    store.threads.mergeContext(threadId, {
      reply_to: { channel: ch.id, conversation: ch.conversation, ...(ch.message ? { message: ch.message } : {}) },
    });
    // In a room the owner's words were said there (`direct`), unlike what they tell the agent from the app.
    const room = Boolean(store.threads.context(threadId).room);
    return post(
      threadId,
      text,
      owner
        ? { kind: "user", ...(room ? { direct: true } : {}) }
        : { kind: "person", id: ch.person_id, name: ch.name, channel: ch.id },
      owner && mode === "steer",
      {
        agent_id: agentId,
        trigger: "channel",
        attachments: files,
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
    "threads.list": ({ project_id, root_thread, include_subthreads, include_archived, engine }) => {
      if (!root_thread)
        return { threads: store.threads.list({ project_id, include_subthreads, include_archived, engine }) };
      if (!store.threads.get(root_thread)) throw notFound(`thread ${root_thread}`);
      return {
        threads: store.threads
          .descendants(root_thread, include_archived)
          .filter((t) => (!project_id || t.project_id === project_id) && (!engine || t.engine === engine)),
      };
    },
    "threads.get": ({ thread }, ctx) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      ownClientThread(thread, ctx);
      return { thread: t, messages: store.messages.list(thread), runs: store.runs.list(thread).map(publicRun) };
    },
    "threads.create": (params, ctx) => createThread(store, params, ctx),
    "threads.send": ({ thread, text, mode, attachments }, ctx) => {
      ownClientThread(thread, ctx);
      const { agent } = threadAgent(thread);
      if (attachments?.length && ctx.actor === "agent" && !ctx.channel)
        throw badRequest("only the owner or a channel attaches files");
      if (ctx.channel) {
        const files = attachedFiles(store, thread, attachments ?? []);
        if (files.some((f) => store.media.get(f.media_id)?.thread_id !== thread))
          throw badRequest("channel attachments must belong to this chat");
        return channelSend(thread, agent.id, text, mode, ctx.channel, files);
      }
      if (mode === "interrupt") engine.interrupt(thread);
      // A model-driven client (another tool's agent) is not the owner: its text arrives as untrusted data, and it
      // never steers a running turn.
      if (ctx.actor === "agent")
        return post(thread, text, { kind: "system" }, false, {
          agent_id: agent.id,
          trigger: "channel",
          origin: {
            kind: "agent",
            id: ctx.client ? `client:${ctx.client.id}` : "external",
            name: ctx.client ? `${ctx.client.name} (an outside app)` : "an external agent client",
            thread_id: thread,
            run_id: "",
          },
        });
      // The owner writing in the app: answers stay in the app (not on the channel the last message came from), except in
      // a contact's chat or a room's, where the owner is telling the agent what to answer or post there.
      const t = store.threads.get(thread);
      const room = t?.channel && store.threads.context(thread).room ? t.channel : undefined;
      const contact = room ?? (t?.channel?.person_id && t.channel.person_id !== OWNER_ID ? t.channel : undefined);
      store.threads.mergeContext(thread, {
        reply_to: contact ? { channel: contact.id, conversation: contact.conversation } : undefined,
      });
      // There the words need their own turn to be framed as what to answer: they never steer.
      return post(thread, text, { kind: "user" }, mode === "steer" && !contact, {
        agent_id: agent.id,
        trigger: "user",
        origin: { kind: "user" },
        ...(attachments?.length ? { attachments: attachedFiles(store, thread, attachments) } : {}),
      });
    },
    "threads.rewind": ({ thread, message, text }) => {
      const { thread: t, agent } = threadAgent(thread);
      if (t.channel) throw conflict("this chat's messages were delivered on a channel: they cannot be taken back");
      if (t.engine) throw conflict("an engine session keeps its own history: it cannot be rewound");
      if (store.threads.busy([thread])) throw conflict("a turn is running in this chat: stop it first");
      const list = store.messages.list(thread, 100_000);
      const at = list.findIndex((m) => m.id === message);
      if (at < 0) throw notFound(`message ${message} in this chat`);
      // An answer goes back to the owner's message that asked for it.
      const from = list.slice(0, at + 1).findLast((m) => m.author.kind === "user");
      if (!from) throw badRequest("there is no message of yours before it to send again");
      const words = text ?? from.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
      if (!words.trim()) throw badRequest("that message has no text to send again");
      const files = from.parts.flatMap((p) =>
        (p.type === "image" || p.type === "file" || p.type === "audio") && p.media_id ? [p.media_id] : [],
      );
      store.tx(() => store.modelLog.dropRuns(thread, store.messages.cutFrom(thread, from.seq)));
      return post(thread, words, { kind: "user" }, false, {
        agent_id: agent.id,
        trigger: "user",
        origin: { kind: "user" },
        ...(files.length ? { attachments: attachedFiles(store, thread, files) } : {}),
      });
    },
    "threads.cancel": ({ thread }) => ({ canceled: engine.cancel(thread) }),
    "threads.voice": ({ thread, on }, ctx) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      if (ctx.agent && ctx.agent.thread_id !== thread) throw unauthorized("an agent changes only its own chat");
      store.threads.mergeContext(thread, { voice_replies: on });
      return { on };
    },
    "threads.search": ({ query, limit }) => ({
      hits: store.messages.search(query, limit).map(({ message: m, snippet }) => ({
        thread_id: m.thread_id,
        message_id: m.id,
        seq: m.seq,
        author: m.author,
        snippet,
        created_at: m.created_at,
      })),
    }),
    "threads.compact": async ({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      return upkeep.compact(thread);
    },
    "threads.read": ({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      store.tx(() => {
        store.threads.patch(thread, { unread: 0 }, false);
        store.notifications.readThread(thread);
      });
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
