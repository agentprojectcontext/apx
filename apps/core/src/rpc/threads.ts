import type { Job } from "@apx/protocol";
import { ErrorCode } from "@apx/protocol";
import { publicRun, type RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import { CallError } from "../errors.ts";
import type { Handler } from "./router.ts";

export const notFound = (what: string) => new CallError({ code: ErrorCode.BadRequest, message: `${what} not found` });

export function threadHandlers(store: Store, engine: Engine) {
  const threadAgent = (threadId: string) => {
    const thread = store.threads.get(threadId);
    if (!thread) throw notFound(`thread ${threadId}`);
    const agent = store.agents.get(thread.agent_ids[0] ?? "");
    if (!agent) throw notFound(`agent of thread ${threadId}`);
    return { thread, agent };
  };

  return {
    "threads.list": (({ project_id, include_subthreads }) => ({
      threads: store.threads.list({ project_id, include_subthreads }),
    })) as Handler<"threads.list">,
    "threads.get": (({ thread }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      return { thread: t, messages: store.messages.list(thread), runs: store.runs.list(thread).map(publicRun) };
    }) as Handler<"threads.get">,
    "threads.create": (({ kind, agent_id, title, project_id }) => {
      const agent = store.agents.get(agent_id);
      if (!agent) throw notFound(`agent ${agent_id}`);
      return store.threads.create({
        kind,
        title: title ?? agent.name,
        agent_ids: [agent.id],
        project_id: project_id ?? agent.project_id,
      });
    }) as Handler<"threads.create">,
    "threads.send": (({ thread, text, mode }, ctx) => {
      const { agent } = threadAgent(thread);
      if (mode === "interrupt") engine.interrupt(thread);
      // A model-driven client (another tool's agent) is not the owner: its text arrives as untrusted data.
      const fromAgent = ctx.actor === "agent";
      return store.tx(() => {
        const message = store.messages.add({
          thread_id: thread,
          author: fromAgent ? { kind: "system" } : { kind: "user" },
          parts: [{ type: "text", text }],
        });
        store.threads.patch(thread, { preview: text.slice(0, 160) });
        const run = engine.admit({
          thread_id: thread,
          agent_id: agent.id,
          trigger: fromAgent ? "channel" : "user",
          origin: fromAgent
            ? { kind: "agent", id: "external", name: "an external agent client", thread_id: thread, run_id: "" }
            : { kind: "user" },
          text,
        });
        return { message, run: publicRun(run) };
      });
    }) as Handler<"threads.send">,
    "threads.cancel": (({ thread }) => ({ canceled: engine.cancel(thread) })) as Handler<"threads.cancel">,
    "threads.read": (({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      store.threads.patch(thread, { unread: 0 }, false);
      return { ok: true as const };
    }) as Handler<"threads.read">,
    "jobs.list": (({ finished }) => {
      const view = (r: RunRecord): Job => {
        const t = store.threads.get(r.thread_id);
        const agent = store.agents.get(r.agent_id);
        return {
          id: r.id,
          kind: "agent",
          title: t?.parent_id ? t.title : `${agent?.name ?? r.agent_id} · ${t?.title ?? r.thread_id}`,
          state: r.state,
          thread_id: r.thread_id,
          ...(t?.parent_id ? { parent_thread_id: t.parent_id } : {}),
          agent_id: r.agent_id,
          trigger: r.trigger,
          ...(r.model ? { model: r.model } : {}),
          ...(r.usage ? { usage: r.usage } : {}),
          tool_calls: r.tool_calls,
          ...(r.activity ? { activity: r.activity } : {}),
          started_at: r.started_at,
          ...(r.ended_at ? { ended_at: r.ended_at } : {}),
        };
      };
      const j = store.runs.jobs(finished);
      return { running: j.running.map(view), finished: j.finished.map(view) };
    }) as Handler<"jobs.list">,
    "runs.get": (({ run }) => {
      const r = store.runs.get(run);
      if (!r) throw notFound(`run ${run}`);
      return publicRun(r);
    }) as Handler<"runs.get">,
    "runs.wait": (async ({ run, timeout_s }) => {
      const r = await engine.wait(run, timeout_s * 1000);
      if (!r) throw notFound(`run ${run}`);
      return publicRun(r);
    }) as Handler<"runs.wait">,
    /** A widget's sendPrompt(): an input on the thread that owns the widget, marked as coming from it. */
    "surfaces.prompt": (({ surface, text }) => {
      const s = store.surfaces.get(surface);
      if (!s) throw notFound(`surface ${surface}`);
      const threadId = s.thread_id ?? "home";
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
    }) as Handler<"surfaces.prompt">,
  };
}
