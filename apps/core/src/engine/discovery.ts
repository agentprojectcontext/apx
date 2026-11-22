import type { DiscoverySettings, DiscoveryStatus } from "@apx/protocol";
import { DISCOVERY_DAY, discoveryState } from "../domain/discovery-state.ts";
import type { BackgroundCheck } from "./background.ts";
import { type DiscoveryCycleDeps, runDiscoveryCycle } from "./discovery-cycle.ts";

export function createDiscovery(
  deps: DiscoveryCycleDeps & { now?: () => Date; deadline?: (ms: number) => AbortSignal },
) {
  const { store } = deps;
  const clock = deps.now ?? (() => new Date());
  const state = discoveryState(store, clock);
  if (state.read().state === "working") state.write({ ...state.read(), state: "uncertain" });
  let generation = 0;
  let stopped = false;
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;
  function status(): DiscoveryStatus {
    const settings = store.settings.read("discovery");
    const runtime = state.read();
    return {
      settings,
      available: deps.models().length > 0,
      state: runtime.state,
      ...(settings.enabled ? { next_at: runtime.next, deep_next_at: runtime.deep_next } : {}),
      ...(runtime.last ? { last_at: runtime.last } : {}),
      coverage: store.projects
        .list()
        .filter((p) => state.allowed(p.id))
        .map((p) => ({ project: p.id, ...runtime.coverage[p.id], planned_at: runtime.questions[p.id]?.planned_at })),
      findings: runtime.findings.filter((f) => state.allowed(f.project)),
      muted_topics: runtime.muted_topics
        .filter((item) => state.allowed(item.project))
        .map(({ id, title }) => ({ id, title })),
      inaccessible: runtime.inaccessible,
    };
  }
  function cancel() {
    generation++;
    controller?.abort();
    const runtime = state.read();
    if (runtime.state === "working") state.write({ ...runtime, state: "cancelled" });
  }
  function configure(patch: Partial<DiscoverySettings>, expected?: DiscoverySettings) {
    state.configure(patch, expected);
    cancel();
    return status();
  }
  async function review(at: Date) {
    const settings = store.settings.read("discovery");
    const current = state.read();
    if (stopped || !settings.enabled || +at < Date.parse(current.next) || !deps.models().length) return;
    const stamp = generation;
    const runtime = {
      ...current,
      next: new Date(+at + DISCOVERY_DAY).toISOString(),
      last: at.toISOString(),
      state: "working" as const,
    };
    state.write(runtime);
    const ac = new AbortController();
    controller = ac;
    const signal = AbortSignal.any([ac.signal, (deps.deadline ?? AbortSignal.timeout)(settings.max_seconds * 1000)]);
    const valid = () => stamp === generation && !stopped && store.settings.read("discovery").enabled;
    try {
      await runDiscoveryCycle(deps, runtime, settings, at, signal, valid);
    } catch {
      if (valid()) {
        const live = state.read();
        state.write({
          ...runtime,
          findings: live.findings,
          seen: live.seen,
          delivered_days: live.delivered_days,
          claims: live.claims,
          muted: live.muted,
          muted_topics: live.muted_topics,
          feedback: live.feedback,
          state: signal.aborted ? "cancelled" : "failed",
          deep_next: new Date(+at + settings.deep_every_days * DISCOVERY_DAY).toISOString(),
        });
      }
    } finally {
      controller = undefined;
    }
  }
  const check: BackgroundCheck = {
    id: "contextual-discovery",
    everyMs: 60_000,
    run(at) {
      if (running) return running;
      running = review(at).finally(() => {
        running = undefined;
      });
      return running;
    },
  };
  return {
    status,
    configure,
    check,
    feedback(id: string, feedback: "useful" | "not_useful" | "mute" | "unmute") {
      state.feedback(id, feedback);
      cancel();
      return status();
    },
    async close() {
      stopped = true;
      cancel();
      await running;
    },
  };
}
export type Discovery = ReturnType<typeof createDiscovery>;
