import { isDeepStrictEqual } from "node:util";
import { DiscoveryFinding, DiscoverySettings, DiscoverySourceFailure } from "@apx/protocol";
import { z } from "zod";
import { conflict, notFound } from "../errors.ts";
import type { Store } from "./store.ts";

export const DISCOVERY_DAY = 86_400_000;
const Runtime = z.object({
  next: z.string().datetime(),
  last: z.string().datetime().optional(),
  deep_next: z.string().datetime(),
  state: z.enum(["waiting", "working", "completed", "failed", "uncertain", "cancelled"]),
  source_attempts: z.record(z.string(), z.string().datetime()),
  snapshots: z.record(z.string(), z.string()),
  questions: z.record(
    z.string(),
    z.object({ question: z.string().max(600), rationale: z.string().max(800), planned_at: z.string().datetime() }),
  ),
  plan_attempts: z.record(z.string(), z.string().datetime()),
  feedback: z.record(z.string(), z.enum(["useful", "not_useful", "mute"])),
  coverage: z.record(
    z.string(),
    z.object({ reviewed_at: z.string().datetime().optional(), researched_at: z.string().datetime().optional() }),
  ),
  findings: z.array(DiscoveryFinding).max(100),
  muted: z.array(z.string()).max(500),
  muted_topics: z
    .array(z.object({ id: z.string(), topic: z.string(), title: z.string(), project: z.string().optional() }))
    .max(500),
  inaccessible: z.array(DiscoverySourceFailure).max(40),
  delivered_days: z.array(z.string()).max(100),
  claims: z
    .array(z.object({ run: z.string(), routine: z.string(), finding: z.string(), composed: z.boolean() }))
    .max(100),
  seen: z
    .array(
      z.object({
        topic: z.string(),
        fingerprint: z.string().optional(),
        at: z.string().datetime(),
        project: z.string().optional(),
      }),
    )
    .max(500),
});
export type DiscoveryRuntime = z.infer<typeof Runtime>;

export function discoveryState(store: Store, now: () => Date) {
  const write = (state: DiscoveryRuntime) =>
    store.settings.set("discovery_runtime", JSON.stringify(Runtime.parse(state)));
  const read = (): DiscoveryRuntime => {
    const stored = store.settings.get("discovery_runtime");
    if (stored) {
      try {
        const parsed = Runtime.safeParse(JSON.parse(stored));
        if (parsed.success) return parsed.data;
      } catch {
        /* Invalid state never authorizes research or delivery. */
      }
    }
    const at = stored ? "9999-01-01T00:00:00.000Z" : now().toISOString();
    return {
      next: at,
      deep_next: at,
      state: stored ? "uncertain" : "waiting",
      questions: {},
      plan_attempts: {},
      feedback: {},
      coverage: {},
      source_attempts: {},
      snapshots: {},
      findings: [],
      muted: [],
      muted_topics: [],
      inaccessible: [],
      delivered_days: [],
      claims: [],
      seen: [],
    };
  };
  const allowed = (project: string | undefined, settings = store.settings.read("discovery")) => {
    if (!project) return true;
    const p = store.projects.get(project);
    return (
      !!p &&
      p.registered !== false &&
      !p.unreadable &&
      (settings.projects === "all" || settings.project_ids.includes(project))
    );
  };
  return {
    read,
    write,
    allowed,
    configure(patch: Partial<DiscoverySettings>, expected?: DiscoverySettings) {
      const before = store.settings.read("discovery");
      if (expected && !isDeepStrictEqual(before, expected))
        throw conflict("Discovery settings changed; reload before saving");
      const settings = DiscoverySettings.parse({ ...before, ...patch });
      for (const id of settings.project_ids) if (!store.projects.get(id)) throw notFound(`project ${id}`);
      for (const source of settings.sources)
        if (source.project && !allowed(source.project, settings))
          throw conflict("A source belongs to an excluded project");
      if (settings.report_routine) {
        const routine = store.routines.get(settings.report_routine);
        const agent = routine && store.agents.get(routine.agent_id);
        if (!routine || routine.project_id || agent?.kind !== "secretary" || routine.action !== "agent")
          throw conflict("Choose a global report run by the super-agent");
      }
      store.tx(() => {
        const previous = read();
        store.settings.write("discovery", settings);
        // Changing the source authorization invalidates cached evidence, not just pending work.
        write({
          ...previous,
          next: now().toISOString(),
          deep_next: now().toISOString(),
          state: "cancelled",
          findings: [],
          claims: [],
          coverage: {},
          questions: {},
          plan_attempts: {},
          source_attempts: {},
          snapshots: {},
          inaccessible: [],
        });
      });
    },
    feedback(id: string, feedback: "useful" | "not_useful" | "mute" | "unmute") {
      store.tx(() => {
        const runtime = read();
        const finding = runtime.findings.find((f) => f.id === id && allowed(f.project));
        if (feedback === "unmute") {
          const preference = runtime.muted_topics.find((item) => item.id === id && allowed(item.project));
          const topic = finding?.topic ?? preference?.topic;
          if (!topic) throw notFound("muted topic");
          for (const item of runtime.findings)
            if (item.topic === topic && item.feedback === "mute") delete item.feedback;
          if (runtime.feedback[topic] === "mute") delete runtime.feedback[topic];
          runtime.muted = runtime.muted.filter((item) => item !== topic);
          runtime.muted_topics = runtime.muted_topics.filter((item) => item.topic !== topic);
        } else {
          if (!finding) throw notFound("finding");
          finding.feedback = feedback;
          runtime.feedback[finding.topic] = feedback;
          if (feedback === "mute") {
            runtime.muted = [...new Set([...runtime.muted, finding.topic])].slice(-500);
            runtime.muted_topics = [
              ...runtime.muted_topics.filter((item) => item.topic !== finding.topic),
              {
                id: finding.id,
                topic: finding.topic,
                title: finding.title,
                ...(finding.project ? { project: finding.project } : {}),
              },
            ].slice(-500);
          }
        }
        write(runtime);
      });
    },
  };
}
