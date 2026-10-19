import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import type { VmPrototype } from "../environments/prototype.ts";
import { conflict, unauthorized, unavailable } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function environmentHandlers(store: Store, vm?: VmPrototype, cancel: Engine["cancel"] = () => 0) {
  const enabled = () => {
    if (!vm) throw unavailable("the VM prototype is not enabled on this core");
    return vm;
  };
  return {
    "environments.status": () => vm?.status() ?? { enabled: false, ready: false, name: "", workspace: "" },
    "environments.enable": ({ thread, appearance }) => enabled().enable(thread, appearance),
    "environments.control": ({ thread, mode }) => enabled().control(thread, mode, () => cancel(thread)),
    "environments.stop": ({ thread }) =>
      enabled().stop(thread, () => {
        cancel(thread);
      }),
    "environments.appearance": ({ thread, appearance }) => enabled().appearance(thread, appearance),
    "environments.bind": ({ thread }) => {
      enabled().bind(thread);
      return { ok: true as const };
    },
    "environments.display": async ({ thread }, ctx) => {
      await enabled().requireRunning(thread);
      return enabled().display(thread, ctx.device?.id);
    },
    "environments.command": ({ thread, command }, ctx) => {
      if (ctx.client || ctx.channel || (ctx.actor === "agent" && !ctx.agent))
        throw unauthorized("owner or bound native run required");
      if (ctx.agent) {
        const run = store.runs.get(ctx.agent.run_id);
        if (
          run?.state !== "working" ||
          run.thread_id !== thread ||
          ctx.agent.thread_id !== thread ||
          run.agent_id !== ctx.agent.id
        )
          throw conflict("VM command does not belong to this run");
      }
      return enabled().command(thread, command, ctx.agent ? "agent" : "human");
    },
  } satisfies Partial<Handlers>;
}
