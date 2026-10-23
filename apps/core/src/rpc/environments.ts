import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import type { Computer } from "../environments/computer.ts";
import { badRequest, conflict, unauthorized, unavailable } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

export function environmentHandlers(store: Store, vm?: Computer, cancel: Engine["cancel"] = () => 0) {
  const enabled = () => {
    if (!vm) throw unavailable("the isolated computer is not available on this core");
    return vm;
  };
  /** The owner, or an agent's tool acting from a working run of that very chat; never an outside client or channel. */
  const caller = (thread: string, ctx: CallContext) => {
    if (ctx.client || ctx.channel || (ctx.actor === "agent" && !ctx.agent))
      throw unauthorized("owner or bound native run required");
    if (!ctx.agent) return undefined;
    const run = store.runs.get(ctx.agent.run_id);
    if (
      run?.state !== "working" ||
      run.thread_id !== thread ||
      ctx.agent.thread_id !== thread ||
      run.agent_id !== ctx.agent.id
    )
      throw conflict("VM command does not belong to this run");
    if (!enabled().permitted(ctx.agent.id, thread)) throw unauthorized("this agent may not use the computer");
    return run;
  };
  const appearance = () => (store.settings.get("vm_appearance") === "dark" ? "dark" : "light");
  return {
    "environments.status": ({ thread }) =>
      vm?.status(thread) ?? { enabled: false, ready: false, name: "", workspace: "" },
    "environments.enable": ({ thread, appearance }) => enabled().enable(thread, appearance),
    "environments.start": ({ thread }, ctx) => {
      const run = caller(thread, ctx);
      return run ? enabled().start(thread, appearance(), run.id) : enabled().enable(thread, appearance());
    },
    "environments.configure": async (params) => {
      const computer = enabled();
      const status = await computer.status();
      for (const key of ["memory_gib", "cpus", "disk_gib"] as const) {
        const value = params[key];
        const range = status.limits[key];
        if (value !== undefined && (value < range.min || value > range.max))
          throw badRequest(`${key} must be between ${range.min} and ${range.max} on this computer`);
      }
      if (params.disk_gib !== undefined && status.disk_min_gib !== undefined && params.disk_gib < status.disk_min_gib)
        throw badRequest(`the VM's disk only grows: pick ${status.disk_min_gib} GiB or more`);
      const next = { ...store.settings.read("computer"), ...params };
      store.settings.write("computer", next);
      return { resources: computer.resources(), idle_minutes: next.idle_minutes };
    },
    "environments.permit": ({ agent, on }) => enabled().permit(agent, on),
    "environments.control": ({ thread, mode }) => enabled().control(thread, mode, () => cancel(thread)),
    "environments.stop": ({ thread }, ctx) =>
      caller(thread, ctx)
        ? enabled().stop(thread, () => {}, "agent")
        : enabled().stop(thread, () => {
            cancel(thread);
          }),
    "environments.appearance": ({ thread, appearance }) => enabled().appearance(thread, appearance),
    "environments.bind": ({ thread }) => {
      const computer = enabled();
      if (!computer.serves(thread)) throw badRequest("use an owner's native chat");
      const agent = store.threads.get(thread)?.agent_ids[0];
      if (agent && !computer.permitted(agent, thread))
        throw conflict(`${store.agents.get(agent)?.name ?? agent} may not use the computer; allow it first`);
      computer.bind(thread);
      return { ok: true as const };
    },
    "environments.display": async ({ thread }, ctx) => {
      await enabled().requireRunning(thread);
      return enabled().display(thread, ctx.device?.id);
    },
    "environments.command": ({ thread, command }, ctx) => {
      const run = caller(thread, ctx);
      return enabled().command(thread, command, run ? "agent" : "human");
    },
  } satisfies Partial<Handlers>;
}
