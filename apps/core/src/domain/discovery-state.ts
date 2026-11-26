import { isDeepStrictEqual } from "node:util";
import {
  type DiscoveryAdd,
  type DiscoveryAdded,
  DiscoveryFinding,
  DiscoverySettings,
  DiscoverySourceFailure,
} from "@apx/protocol";
import { z } from "zod";
import { conflict, notFound } from "../errors.ts";
import { ownerTimeZone } from "./owner.ts";
import { shortInterests } from "./research-terms.ts";
import type { Store } from "./store.ts";

export const DISCOVERY_DAY = 86_400_000;
/**
 * Public pages are read in depth every other day: projects are still looked at daily, and two days keep the web reads
 * and model calls a finding costs low while news is still fresh (DECISIONS.md#d-278).
 */
export const DEEP_EVERY_DAYS = 2;
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
  /** The owner's days whose morning summary was already looked at (automatic delivery). */
  digest_days: z.array(z.string()).max(100).default([]),
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

/**
 * Research's settings with what APX can tell on its own filled in, so turning it on asks nothing: the owner's time zone
 * and the super-agent's one daily report (the profile's morning brief when there are several). A value the owner chose
 * is kept; it is never turned on here (DECISIONS.md#d-276).
 */
function discoveryDefaults(store: Store, settings: DiscoverySettings): DiscoverySettings {
  const zone = ownerTimeZone(store);
  const reports = store.routines
    .list()
    .filter(
      (r) => r.enabled && !r.project_id && r.action === "agent" && store.agents.get(r.agent_id)?.kind === "secretary",
    );
  const morning = reports.filter((r) => r.origin === "secretary:day-open");
  const report = reports.length === 1 ? reports[0] : morning.length === 1 ? morning[0] : undefined;
  return {
    ...settings,
    ...(zone && settings.timezone === "UTC" ? { timezone: zone } : {}),
    ...(settings.report_routine === null && report ? { report_routine: report.id } : {}),
  };
}

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
      digest_days: [],
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
    /** At start, while research is off: the values it would start with are kept up to date for the panel. */
    prefill() {
      const before = store.settings.read("discovery");
      if (before.enabled) return;
      const settings = discoveryDefaults(store, before);
      if (!isDeepStrictEqual(settings, before)) store.settings.write("discovery", settings);
    },
    configure(patch: Partial<DiscoverySettings>, expected?: DiscoverySettings) {
      const before = store.settings.read("discovery");
      if (expected && !isDeepStrictEqual(before, expected))
        throw conflict("Discovery settings changed; reload before saving");
      const asked = DiscoverySettings.parse({ ...before, ...patch });
      // Turned on: what APX can tell on its own is filled in, unless this change sets it.
      const settings =
        asked.enabled && !before.enabled
          ? {
              ...discoveryDefaults(store, asked),
              ...(patch.timezone ? { timezone: patch.timezone } : {}),
              ...(patch.report_routine !== undefined ? { report_routine: patch.report_routine } : {}),
            }
          : asked;
      for (const id of settings.project_ids) if (!store.projects.get(id)) throw notFound(`project ${id}`);
      for (const source of settings.sources)
        if (source.project && !allowed(source.project, settings))
          throw conflict("A source belongs to an excluded project");
      if (settings.enabled && settings.delivery === "routine" && !settings.report_routine)
        throw conflict("Choose the routine that tells the findings");
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
    /**
     * Adds what came up with the owner. It only widens what research looks at, so what it found stays and its schedule
     * is kept (DECISIONS.md#d-276); the answer is what was new.
     */
    add(items: DiscoveryAdd): DiscoveryAdded {
      const before = store.settings.read("discovery");
      if (!before.enabled) throw conflict("Research is off");
      const has = new Set(before.interests.map((i) => i.toLowerCase()));
      // Search terms, not sentences: what the agent heard comes in short (DECISIONS.md#d-278).
      const interests = shortInterests(items.interests ?? []).filter((i) => !has.has(i.toLowerCase()));
      if (before.interests.length + interests.length > 30) throw conflict("Research already has 30 interests");
      for (const id of items.projects ?? [])
        if (!allowed(id, { ...before, projects: "all" })) throw notFound(`project ${id}`);
      const projects =
        before.projects === "all"
          ? []
          : [...new Set(items.projects ?? [])].filter((id) => !before.project_ids.includes(id));
      const known = new Set(before.sources.flatMap((s) => s.pages));
      const pages = (items.pages ?? []).filter(
        (p, i, all) => !known.has(p.url) && all.findIndex((q) => q.url === p.url) === i,
      );
      for (const page of pages)
        if (page.project && !allowed(page.project, { ...before, project_ids: [...before.project_ids, ...projects] }))
          throw notFound(`project ${page.project}`);
      const near = new Set(before.places.map((p) => p.toLowerCase()));
      const places = [...new Set((items.places ?? []).map((p) => p.trim()))].filter((p) => !near.has(p.toLowerCase()));
      if (before.places.length + places.length > 10) throw conflict("Research already has 10 places");
      const settings = DiscoverySettings.parse({
        ...before,
        interests: [...before.interests, ...interests],
        project_ids: [...before.project_ids, ...projects],
        sources: [
          ...before.sources,
          ...pages.map((p) => ({
            label: p.label,
            public_terms: "",
            pages: [p.url],
            ...(p.project ? { project: p.project } : {}),
          })),
        ],
        places: [...before.places, ...places],
      });
      if (!isDeepStrictEqual(settings, before)) store.settings.write("discovery", settings);
      return {
        interests,
        projects,
        pages: pages.map(({ url, label }) => ({ url, label })),
        places,
      };
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
