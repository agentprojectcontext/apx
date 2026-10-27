// Native update sequencing remains available when the remote panel cannot load.
import { compareVersions, type Result } from "@apx/protocol";
export type Coordination = Result<"system.update_prepare">;
export type UpdateState = Result<"system.update_state">;
export type PendingUpdate = { identity: string; home: string; target: string };
type Answer = { ok: true; ready: boolean } | { ok: false; error: string };
export type UpdateEndpoint = {
  identity: string;
  local: boolean;
  health(): Promise<{ home_id?: string; protocol: number }>;
  state(): Promise<UpdateState>;
  prepare(target: string): Promise<Coordination>;
  apply(target: string): Promise<{ ok: boolean; log: string }>;
};

export function createUpdateCoordinator(opts: {
  current: string;
  load(): PendingUpdate | undefined;
  save(pending: PendingUpdate | undefined): void;
  stage(target: string): Promise<Answer>;
  activate(): void;
  sleep(): Promise<void>;
  now(): number;
  timeoutMs: number;
  failed(error: string): void;
}) {
  let endpoint: UpdateEndpoint | undefined;
  let revision = 0;
  let flight: Promise<Answer> | undefined;
  let authorized: PendingUpdate | undefined;
  const pending = () => opts.load();
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function run(target?: string): Promise<Answer> {
    const active = endpoint;
    const generation = revision;
    authorized = undefined;
    const unchanged = () => {
      if (endpoint !== active || generation !== revision)
        throw new Error("The APX connection changed. Retry the update.");
    };
    try {
      if (!active) throw new Error("Connect to APX before updating.");
      if (active.local) {
        if (!target) throw new Error("No target release selected.");
        return await opts.stage(target);
      }
      const health = await active.health();
      unchanged();
      if (!health.home_id)
        throw new Error("The server cannot identify this installation. Update the server before this app.");
      const state = await active.state();
      unchanged();
      // The authenticated update lane stays compatible across main protocol upgrades.
      if (state.coordination_protocol !== 1) throw new Error("This server uses an incompatible update protocol.");
      if (!state.supported)
        throw new Error(state.error ?? "This server does not support coordinated updates. Update it before this app.");
      const saved = pending();
      if (saved?.identity === active.identity && saved.home !== health.home_id)
        throw new Error("The server identity differs from the pending update. This app was not applied.");
      const matching = saved?.identity === active.identity && saved.home === health.home_id ? saved : undefined;
      // Active plans and completed releases this app still needs win over a newer feed.
      const plan = state.coordination;
      const sharedTarget =
        plan && plan.phase !== "failed" && (plan.phase !== "complete" || compareVersions(plan.target, opts.current) > 0)
          ? plan.target
          : undefined;
      const interruptedTarget =
        matching && compareVersions(matching.target, opts.current) > 0 ? matching.target : undefined;
      const selected =
        sharedTarget ?? interruptedTarget ?? target ?? (plan?.phase === "complete" ? plan.target : undefined);
      if (!selected) throw new Error("No shared target release is available.");
      if (compareVersions(selected, opts.current) < 0)
        throw new Error("The server target is older than this app. Update the server before retrying.");
      const record = { identity: active.identity, home: health.home_id, target: selected };
      opts.save(record);
      const prepared = await active.prepare(selected);
      unchanged();
      if (prepared.target !== selected || prepared.phase === "failed")
        throw new Error(prepared.error ?? "The server could not prepare the selected release.");
      const staged = selected === opts.current ? { ok: true as const, ready: false } : await opts.stage(selected);
      unchanged();
      if (!staged.ok) throw new Error(staged.error);
      if (prepared.running !== selected && prepared.phase === "prepared") {
        try {
          const result = await active.apply(selected);
          unchanged();
          if (!result.ok) throw new Error(result.log || "The server update failed.");
        } catch (error) {
          unchanged();
          // A response can be lost during restart; only the authenticated state below can authorize activation.
          const check = await active.state().catch(() => undefined);
          if (check && check.coordination_protocol !== 1)
            throw new Error("The server update protocol changed during the update.");
          if (check?.coordination?.phase === "failed") throw new Error(check.coordination.error ?? message(error));
          if (check && check.running !== selected && check.coordination?.phase === "prepared") throw error;
        }
      }
      const deadline = opts.now() + opts.timeoutMs;
      while (opts.now() < deadline) {
        unchanged();
        const check = await active.state().catch(() => undefined);
        unchanged();
        if (check && check.coordination_protocol !== 1)
          throw new Error("The server update protocol changed during the update.");
        if (check?.coordination?.phase === "failed")
          throw new Error(check.coordination.error ?? "The server update failed.");
        if (check?.running === selected) {
          const confirmed = await active.health();
          unchanged();
          if (!check.supported)
            throw new Error(check.error ?? "The updated server no longer supports coordinated updates.");
          if (confirmed.home_id !== record.home) throw new Error("The server identity changed during the update.");
          if (selected === opts.current) opts.save(undefined);
          authorized = record;
          return staged;
        }
        await opts.sleep();
      }
      throw new Error(
        "The server has not confirmed the target release. This app was not applied. Retry after reconnecting.",
      );
    } catch (error) {
      const text = message(error);
      opts.failed(text);
      return { ok: false, error: text };
    }
  }

  function install(target?: string): Promise<Answer> {
    flight ??= run(target).finally(() => {
      flight = undefined;
    });
    return flight;
  }

  return {
    connect(next: UpdateEndpoint | undefined) {
      endpoint = next;
      revision++;
      authorized = undefined;
    },
    install,
    /** Reconcile offline clients and interrupted updates without forcing a restart. */
    async reconcile(): Promise<void> {
      const active = endpoint;
      if (!active || active.local || flight) return;
      try {
        const state = await active.state();
        if (endpoint !== active) return;
        const target = state.coordination?.target;
        const saved = pending();
        if (
          (target && compareVersions(target, opts.current) > 0 && state.coordination?.phase !== "failed") ||
          saved?.identity === active.identity
        )
          await install(target);
      } catch {
        // Offline and legacy servers stay blocked; an explicit update reports actionable recovery.
      }
    },
    async restart(): Promise<void> {
      if (endpoint?.local) return opts.activate();
      const saved = authorized ?? pending();
      if (!saved || saved.identity !== endpoint?.identity) return;
      const answer = await install(saved.target);
      if (answer.ok && authorized) opts.activate();
    },
    canApplyOnQuit(): boolean {
      // A remote core may change while the app is put away. Recheck asynchronously on explicit restart instead.
      return endpoint?.local === true;
    },
  };
}
