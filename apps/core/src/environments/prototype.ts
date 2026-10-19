import { TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { badRequest, conflict, unavailable } from "../errors.ts";
import { computerControl } from "./control.ts";
import { guestOperations } from "./guest-operations.ts";
import type { Appearance, VmLifecycle } from "./lifecycle.ts";

export type VmPrototypeConfig = {
  limaHome: string;
  instance: string;
  model?: string;
  managed?: boolean;
  demo?: boolean;
  executable?: () => string;
  env?: NodeJS.ProcessEnv;
  lifecycle?: VmLifecycle;
};

/** One owner-bound guest; host tools are never a fallback for its chat. */
export function createVmPrototype(store: Store, config: VmPrototypeConfig) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/.test(config.instance)) throw badRequest("invalid VM name");
  const thread = () => store.settings.get("vm_prototype_thread");
  const check = (id: string) => {
    if (!thread() || thread() !== id || !store.threads.get(id)) throw conflict("this chat has no prototype VM");
  };

  const control = computerControl(store);
  const guest = guestOperations(store, config, check, (id) => vm.requireRunning(id), control);
  const vm = {
    async beforeDelete(ids: string[]) {
      const bound = thread();
      if (!bound || !ids.includes(bound)) return;
      const status = await vm.status();
      if (status.ready || (status.phase && !["stopped", "not_installed", "unsupported"].includes(status.phase)))
        throw conflict("stop Computer before deleting its chat");
      await guest.disconnect();
      store.settings.set("vm_prototype_thread", "");
    },
    hasThread: (id: string) => thread() === id,
    browser: (id: string) => {
      check(id);
      return guest.browser;
    },
    async status() {
      const lifecycle = await config.lifecycle?.status();
      let ready = false;
      if (lifecycle) ready = lifecycle.phase === "running";
      else
        try {
          const lines = await guest.exec(["list", "--json", config.instance]);
          ready = lines
            .split("\n")
            .filter(Boolean)
            .some((line) => (JSON.parse(line) as { status: string }).status === "Running");
        } catch {}
      const bound = thread();
      const model =
        bound &&
        (store.threads.context(bound).model_choice?.model ??
          store.agents.get(store.threads.get(bound)?.agent_ids[0] ?? "")?.model_choice?.model);
      return {
        enabled: config.lifecycle ? Boolean(thread() || store.settings.get("vm_computer_enabled")) : true,
        ready,
        ...control.status(),
        name: config.instance,
        ...(thread() ? { thread: thread() } : {}),
        workspace: "/home/apx-worker/work",
        demo: config.demo === true,
        ...(model || config.model ? { model: model || config.model } : {}),
        ...(lifecycle ?? {}),
      };
    },
    async requireRunning(id: string) {
      check(id);
      if (config.lifecycle && !(await vm.status()).ready)
        throw unavailable("the assigned VM is stopped or not ready; start it from Computer");
    },
    requireAgentControl(id: string) {
      check(id);
      control.assert("agent");
    },
    humanControl: control.human,
    async control(id: string, mode: "agent" | "human", cancel: () => number) {
      await vm.requireRunning(id);
      await control.change(mode, async () => {
        const canceled = cancel();
        const author = store.threads.get(id)?.agent_ids[0];
        if (canceled && author)
          store.messages.add({
            thread_id: id,
            author: { kind: "agent", id: author },
            parts: [
              {
                type: "notice",
                level: "info",
                code: "computer.interrupted",
                vars: {},
                text: "Interrupted: you took control of Computer.",
              },
            ],
          });
        await guest.interrupt();
      });
      return { ok: true as const };
    },
    async enable(id: string, appearance: Appearance) {
      if (!config.lifecycle) throw unavailable("this VM has no lifecycle controller");
      if (!(await config.lifecycle.status()).supported)
        throw unavailable("Computer currently requires macOS Apple Silicon");
      vm.bind(id);
      store.settings.set("vm_appearance", appearance);
      config.lifecycle.start(appearance);
      store.settings.set("vm_computer_enabled", "true");
      return { ok: true as const };
    },
    async stop(id: string, cancel: () => void) {
      check(id);
      if (!config.lifecycle) throw unavailable("this VM has no lifecycle controller");
      config.lifecycle.stop();
      cancel();
      await guest.disconnect();
      return { ok: true as const };
    },
    async appearance(id: string, appearance: Appearance) {
      check(id);
      if (!config.lifecycle) return { ok: true as const };
      store.settings.set("vm_appearance", appearance);
      await config.lifecycle.appearance(appearance);
      return { ok: true as const };
    },
    bind(id: string) {
      if (guest.busy()) throw conflict("a VM command is running");
      const t = store.threads.get(id);
      if (
        !t ||
        !["home", "agent", "loose", "code"].includes(t.kind) ||
        t.engine ||
        audienceOf(store, t).kind !== "owner"
      )
        throw badRequest("use an owner's native chat");
      if (store.runs.list(id).some((run) => !TERMINAL.has(run.state)))
        throw conflict("wait for the chat's active run to end before binding a VM");
      const previous = thread();
      if (previous && previous !== id) throw conflict("prototype already belongs to another chat");
      store.settings.set("vm_prototype_thread", id);
    },
    revokeDevice: guest.revokeDevice,
    display: guest.display,
    connectDisplay: guest.connectDisplay,
    command: guest.command,
    async close() {
      await Promise.all([guest.disconnect(true), config.lifecycle?.close()]);
    },
  };
  return vm;
}

export type VmPrototype = ReturnType<typeof createVmPrototype>;
