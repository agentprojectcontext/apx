// Accounting of work: the background view (agents' runs on their own and terminal commands, as one list) and
// usage by model.
import type { Job, JobFrom } from "@apx/protocol";
import { publicJob } from "../domain/jobs.ts";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import { notFound, unauthorized } from "../errors.ts";
import type { Handlers } from "./router.ts";

const newest = (a: Job, b: Job) => (b.ended_at ?? b.started_at).localeCompare(a.ended_at ?? a.started_at);

/** What a turn carries, without its text: enough for an app to name a queued turn. */
function fromOf(origin: Origin): JobFrom {
  switch (origin.kind) {
    case "agent":
    case "channel":
    case "routine":
    case "task_result":
    case "delegation_result":
      return { kind: origin.kind, name: origin.name };
    case "surface":
      return { kind: origin.kind, name: origin.title };
    // A contact's messages answered once the channel's hours began: shown as theirs.
    case "hours_began":
      return { kind: "channel", name: origin.name };
    default:
      return { kind: origin.kind };
  }
}

export function jobHandlers(store: Store, engine: Engine) {
  const provenance = (job: Job): Job => {
    const thread = store.threads.get(job.thread_id);
    const run = job.run_id ? store.runs.get(job.run_id) : undefined;
    // Only the executing run can fill missing attribution; a chat's participants may be its callers.
    const agentId = job.agent_id ?? (run?.thread_id === job.thread_id ? run.agent_id : undefined);
    return {
      ...job,
      agent_id: agentId,
      thread_title: thread?.title,
      agent_name: agentId ? store.agents.get(agentId)?.name : undefined,
      project_id: job.project_id ?? (run?.thread_id === job.thread_id ? run.input?.project_at_start?.id : undefined),
      project_name:
        job.project_name ?? (run?.thread_id === job.thread_id ? run.input?.project_at_start?.name : undefined),
      thread_project_id: thread?.project_id,
      thread_project_name: thread?.project_id ? store.projects.get(thread.project_id)?.name : undefined,
    };
  };
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
      project_id: r.input?.project_at_start?.id,
      project_name: r.input?.project_at_start?.name,
      trigger: r.trigger,
      ...(r.input ? { from: fromOf(r.input.origin) } : {}),
      ...(r.model ? { model: r.model } : {}),
      ...(r.usage ? { usage: r.usage } : {}),
      tool_calls: r.tool_calls,
      ...(r.activity ? { activity: r.activity } : {}),
      started_at: r.started_at,
      ...(r.ended_at ? { ended_at: r.ended_at } : {}),
    };
  };

  return {
    "usage.summary": ({ since, project, thread }) => {
      // A chat's figures are all it kept; otherwise the last 30 days.
      const from = since ?? (thread ? "" : new Date(Date.now() - 30 * 86_400_000).toISOString());
      return {
        since: from,
        ...(thread ? { totals: store.runs.threadTotals(thread) } : {}),
        aux: thread ? store.auxCalls.ofThread(thread) : store.auxCalls.since(from, project),
        models: store.runs.usage(from, project, thread).map((u) => ({
          model: u.model,
          // Turns run by a CLI on the owner's subscription cost nothing extra; our own loop pays a provider per token.
          billing: u.harness === "native" ? ("metered" as const) : ("included" as const),
          runs: u.runs,
          input: u.input,
          output: u.output,
        })),
      };
    },
    "jobs.list": ({ finished, thread }) => {
      if (thread) {
        const mine = store.jobs
          .ofThread(thread, finished + 20)
          .map(publicJob)
          .map(provenance);
        return {
          running: mine.filter((j) => j.state === "working"),
          finished: mine.filter((j) => j.state !== "working").slice(0, finished),
        };
      }
      const runs = store.runs.jobs(finished);
      return {
        running: [...runs.running.map(view), ...store.jobs.running().map(publicJob)].map(provenance).sort(newest),
        finished: [...runs.finished.map(view), ...store.jobs.finished(finished).map(publicJob)]
          .map(provenance)
          .sort(newest)
          .slice(0, finished),
      };
    },
    "jobs.get": ({ job, offset, max_chars }, ctx) => {
      const j = store.jobs.get(job);
      if (j && ctx.actor !== "human" && ctx.agent?.thread_id !== j.thread_id)
        throw unauthorized("an agent can only read its own thread's jobs");
      if (j) return { job: provenance(publicJob(j)), ...engine.jobs.read(j.id, offset, max_chars) };
      const r = store.runs.get(job);
      if (!r) throw notFound(`job ${job}`);
      return { job: provenance(view(r)), output: "", size: 0, offset: 0 };
    },
    /** An agent may stop only the terminal jobs of its own thread; the owner stops anything. */
    "jobs.cancel": ({ job }, ctx) => {
      const j = store.jobs.get(job);
      const r = j ? undefined : store.runs.get(job);
      const thread = j?.thread_id ?? r?.thread_id;
      if (!thread) throw notFound(`job ${job}`);
      if (ctx.actor !== "human" && (!j || ctx.agent?.thread_id !== thread))
        throw unauthorized("an agent can only stop its own thread's jobs");
      return { canceled: j ? engine.jobs.cancel(j.id) : engine.cancel(thread) > 0 };
    },
  } satisfies Partial<Handlers>;
}
