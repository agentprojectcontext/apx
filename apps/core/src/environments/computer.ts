import { COMPUTER_GRANT } from "@apx/protocol";
import type { ApprovalTarget } from "../domain/approvals.ts";
import { TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { badRequest, conflict, unavailable } from "../errors.ts";
import { computerControl } from "./control.ts";
import { guestOperations } from "./guest-operations.ts";
import type { Appearance, VmLifecycle } from "./lifecycle.ts";
import {
  availableMemory,
  type ComputerResources,
  type Host,
  resolveResources,
  resourceLimits,
  startRefusal,
  thisHost,
} from "./resources.ts";
import type { ComputerUsage } from "./usage.ts";
import { VM_WORKSPACE } from "./worker.ts";

export type ComputerConfig = {
  limaHome: string;
  instance: string;
  model?: string;
  managed?: boolean;
  demo?: boolean;
  executable?: () => string;
  env?: NodeJS.ProcessEnv;
  lifecycle?: VmLifecycle;
  /** The memory, CPUs and disk the instance was last given (its lima.yaml); empty before it exists. */
  applied?: () => Partial<ComputerResources>;
  usage?: () => Promise<ComputerUsage>;
  /** Free host memory in bytes; tests pass their own. */
  freeMemory?: () => Promise<number>;
  host?: Host;
};

/** The grant that lets one agent use the computer: for good, or for one chat (DECISIONS.md#d-139). */
export const computerApproval: ApprovalTarget = {
  key: COMPUTER_GRANT,
  server: "apx",
  tool: "computer",
  permanent: false,
};

export type StopReason = "owner" | "agent" | "idle" | "memory";

const NATIVE_CHATS = new Set(["home", "agent", "loose", "code"]);
const OFF_PHASES = new Set(["stopped", "not_installed", "error", "unsupported"]);

/** One owner-bound guest; host tools are never a fallback for its chat. */
export function createComputer(store: Store, config: ComputerConfig) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/.test(config.instance)) throw badRequest("invalid VM name");
  const host = config.host ?? thisHost();
  const freeMemory = config.freeMemory ?? (() => availableMemory());
  const thread = () => store.settings.get("computer_thread");
  const check = (id: string) => {
    if (!thread() || thread() !== id || !store.threads.get(id)) throw conflict("this chat has no computer assigned");
  };
  let activity = Date.now();
  const touch = () => {
    activity = Date.now();
  };

  const control = computerControl(store);
  const guest = guestOperations(store, config, check, (id) => vm.requireRunning(id), control, touch);
  /** What the next start gives the VM; a disk already larger stays as it is, since Lima only grows one. */
  const resources = (): ComputerResources => {
    const wanted = resolveResources(store.settings.read("computer"), host);
    const disk = config.applied?.().disk_gib;
    return disk && disk > wanted.disk_gib ? { ...wanted, disk_gib: disk } : wanted;
  };
  /** An owner's native chat with no outside engine: the only kind a computer serves. */
  const nativeChat = (id: string) => {
    const t = store.threads.get(id);
    return t && NATIVE_CHATS.has(t.kind) && !t.engine && audienceOf(store, t).kind === "owner" ? t : undefined;
  };
  const busyRun = (id: string, except?: string) =>
    store.runs.list(id).some((run) => run.id !== except && !TERMINAL.has(run.state));
  const vm = {
    async beforeDelete(ids: string[]) {
      const bound = thread();
      if (!bound || !ids.includes(bound)) return;
      const status = await vm.status();
      if (status.ready || (status.phase && !OFF_PHASES.has(status.phase)))
        throw conflict("stop Computer before deleting its chat");
      await guest.disconnect();
      store.settings.set("computer_thread", "");
    },
    hasThread: (id: string) => thread() === id,
    /** A chat a computer can serve: the owner's own, native, with no outside engine. */
    serves: (id: string) => Boolean(nativeChat(id)),
    /** Whether an agent may use the computer in a chat: the owner's grant, for good or for that chat. */
    permitted: (agent: string, id?: string) => store.approvals.allows(computerApproval, id, agent),
    /** The owner turns one agent's permission on or off for good; turning it off also ends grants for single chats. */
    permit(agent: string, on: boolean) {
      if (!store.agents.get(agent)) throw badRequest(`no agent ${agent}`);
      if (on) store.approvals.grant(computerApproval, "always", "", agent);
      else {
        store.approvals.revoke(computerApproval.key, undefined, agent);
        for (const g of store.approvals.list())
          if (g.key === computerApproval.key && g.thread_id && store.threads.get(g.thread_id)?.agent_ids[0] === agent)
            store.approvals.revoke(g.key, g.thread_id);
      }
      return { ok: true as const };
    },
    /** Set up once by the owner: from then on agents in their chats may ask to use it. */
    offered: () => Boolean(config.lifecycle) && store.settings.get("computer_enabled") === "true",
    browser: (id: string) => {
      check(id);
      touch();
      return guest.browser;
    },
    resources,
    freeMemory,
    /** Worth probing: never seen yet, or last seen running (an error may leave the guest up). */
    mayRun: () => {
      if (!config.lifecycle) return false;
      const seen = config.lifecycle.seen();
      return seen === undefined || seen === "running" || seen === "error";
    },
    async status(forThread?: string) {
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
      const chat = forThread ?? bound;
      const agent = chat ? store.threads.get(chat)?.agent_ids[0] : undefined;
      const model =
        bound &&
        (store.threads.context(bound).model_choice?.model ??
          store.agents.get(store.threads.get(bound)?.agent_ids[0] ?? "")?.model_choice?.model);
      const wanted = resources();
      const applied = config.applied?.() ?? {};
      const restart =
        ready &&
        (applied.memory_gib !== wanted.memory_gib ||
          applied.cpus !== wanted.cpus ||
          (applied.disk_gib ?? 0) < wanted.disk_gib);
      const stopped = store.settings.get("computer_last_stop");
      return {
        enabled: config.lifecycle ? Boolean(thread() || vm.offered()) : true,
        ready,
        ...control.status(),
        name: config.instance,
        ...(bound ? { thread: bound } : {}),
        ...(agent
          ? { agent, agent_name: store.agents.get(agent)?.name ?? agent, permitted: vm.permitted(agent, chat) }
          : {}),
        workspace: VM_WORKSPACE,
        demo: config.demo === true,
        ...(model || config.model ? { model: model || config.model } : {}),
        resources: wanted,
        limits: resourceLimits(host),
        ...(applied.disk_gib ? { disk_min_gib: applied.disk_gib } : {}),
        ...(restart ? { restart: true } : {}),
        idle_minutes: store.settings.read("computer").idle_minutes,
        ...(stopped ? { last_stop: JSON.parse(stopped) as { reason: StopReason; at: string } } : {}),
        ...(lifecycle ?? {}),
      };
    },
    async requireRunning(id: string) {
      check(id);
      if (config.lifecycle && !(await vm.status()).ready)
        throw unavailable("the computer is stopped or not ready; start it with the computer tool or from Computer");
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
      touch();
      return { ok: true as const };
    },
    /** The owner's start from Computer: the chat's agent must be allowed first. */
    async enable(id: string, appearance: Appearance) {
      const agent = nativeChat(id)?.agent_ids[0];
      if (agent && !vm.permitted(agent, id))
        throw conflict(`${store.agents.get(agent)?.name ?? agent} may not use the computer; allow it first`);
      return vm.start(id, appearance);
    },
    /**
     * Assigns the chat (moving the computer from a chat where it is off) and starts it, unless free host memory cannot
     * hold it. `run` is the caller's own run, which may go on in the chat it assigns.
     */
    async start(id: string, appearance: Appearance, run?: string) {
      const lifecycle = config.lifecycle;
      if (!lifecycle) throw unavailable("this VM has no lifecycle controller");
      const now = await lifecycle.status();
      if (!now.supported) throw unavailable("Computer currently requires macOS Apple Silicon");
      if (thread() === id && (now.phase === "running" || now.phase === "preparing")) return { ok: true as const };
      if (now.phase === "stopping") throw conflict("Computer is shutting down; start it again once it is off");
      const refusal = startRefusal(resources(), await freeMemory());
      if (refusal) throw conflict(refusal);
      vm.bind(id, run, now.phase);
      store.settings.set("vm_appearance", appearance);
      touch();
      lifecycle.start(appearance);
      store.settings.set("computer_enabled", "true");
      return { ok: true as const };
    },
    async stop(id: string, cancel: () => void, reason: StopReason = "owner") {
      check(id);
      await vm.halt(reason, cancel);
      return { ok: true as const };
    },
    /** Shuts the guest down and keeps its disk; the reason is kept for the owner to read. */
    async halt(reason: StopReason, cancel: () => void = () => {}) {
      if (!config.lifecycle) throw unavailable("this VM has no lifecycle controller");
      config.lifecycle.stop();
      store.settings.set("computer_last_stop", JSON.stringify({ reason, at: new Date().toISOString() }));
      cancel();
      await guest.disconnect();
    },
    /** When the guest was last used: a command, a browser call, a viewer or a change of control. */
    lastActivity: () => Math.max(activity, guest.lastViewed()),
    watched: () => guest.watching(),
    async appearance(id: string, appearance: Appearance) {
      check(id);
      if (!config.lifecycle) return { ok: true as const };
      store.settings.set("vm_appearance", appearance);
      await config.lifecycle.appearance(appearance);
      return { ok: true as const };
    },
    bind(id: string, run?: string, phase?: string) {
      if (guest.busy()) throw conflict("a VM command is running");
      if (!nativeChat(id)) throw badRequest("use an owner's native chat");
      if (busyRun(id, run)) throw conflict("wait for the chat's active run to end before binding a VM");
      const previous = thread();
      if (previous && previous !== id && store.threads.get(previous)) {
        // It moves only while off and idle, so no turn there loses its computer mid-way.
        if (!phase || !OFF_PHASES.has(phase) || busyRun(previous))
          throw conflict("the computer already belongs to another chat; stop it there first");
      }
      store.settings.set("computer_thread", id);
    },
    usage: async (): Promise<ComputerUsage | undefined> => config.usage?.(),
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

export type Computer = ReturnType<typeof createComputer>;
