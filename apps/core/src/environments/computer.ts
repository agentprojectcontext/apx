import { COMPUTER_GRANT } from "@apx/protocol";
import type { ApprovalTarget } from "../domain/approvals.ts";
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { badRequest, conflict, unavailable } from "../errors.ts";
import { availableMemory } from "../usage.ts";
import { type ComputerControl, computerControl } from "./control.ts";
import { guestOperations } from "./guest-operations.ts";
import type { Appearance, VmLifecycle } from "./lifecycle.ts";
import { type ReadyEvent, type ReadyStage, readyWaiters } from "./ready.ts";
import {
  type ComputerResources,
  type Host,
  refusalText,
  resolveResources,
  resourceLimits,
  startRefusal,
  thisHost,
} from "./resources.ts";
import { maxScreens, screenLedger } from "./screens.ts";
import type { ComputerUsage } from "./usage.ts";
import { AGENT_WORKSPACE, screenUser } from "./worker.ts";

export type ComputerConfig = {
  limaHome: string;
  instance: string;
  model?: string;
  managed?: boolean;
  demo?: boolean;
  executable?: () => string;
  env?: NodeJS.ProcessEnv;
  lifecycle?: VmLifecycle;
  /** Starts, restyles and stops an agent's screen in the guest; without it (tests) a claim needs nothing started. */
  screens?: {
    start(screen: number, mode: Appearance, all: number[], signal?: AbortSignal): Promise<void>;
    stop(screen: number): Promise<void>;
    appearance?(screen: number, mode: Appearance): Promise<void>;
  };
  /** The memory, CPUs and disk the instance was last given (its lima.yaml); empty before it exists. */
  applied?: () => Partial<ComputerResources>;
  usage?: () => Promise<ComputerUsage>;
  /** How long a screen may take to start; tests shorten it. */
  claimMs?: number;
  /** Free host memory in bytes; tests pass their own. */
  freeMemory?: () => Promise<number>;
  host?: Host;
};

/** The grant that lets one agent use the computer: for good, or for one chat (DECISIONS.md#d-151). */
export const computerApproval: ApprovalTarget = {
  key: COMPUTER_GRANT,
  server: "apx",
  tool: "computer",
  permanent: false,
};

export type StopReason = "owner" | "agent" | "idle" | "memory";

// Home is not among them: what reaches the owner there (channels, task results) needs the Mac's tools (D-154).
const NATIVE_CHATS = new Set(["agent", "loose", "code"]);
const MONITOR_TTL_MS = 5_000;

/**
 * One shared Linux VM for every allowed agent: each works as its own user on its own screen, the core keeps who
 * holds which screen, and a chat on the computer never falls back to host tools (DECISIONS.md#d-152).
 */
export function createComputer(store: Store, config: ComputerConfig) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/.test(config.instance)) throw badRequest("invalid VM name");
  const host = config.host ?? thisHost();
  const freeMemory = config.freeMemory ?? (() => availableMemory());
  const chats = () => store.settings.read("computer_chats");
  const appearance = (): Appearance => (store.settings.get("vm_appearance") === "dark" ? "dark" : "light");
  let activity = Date.now();
  const touch = () => {
    activity = Date.now();
  };
  const leases = new Map<number, ComputerControl>();
  let probe: { at: number; value: Promise<ComputerUsage | undefined> } | undefined;
  let wake: (e: ReadyEvent) => void = () => {};
  let progress: (thread: string, stage: ReadyStage) => void = () => {};
  const ready = readyWaiters({
    phase: async () => (config.lifecycle ? await config.lifecycle.status() : { phase: "running" }),
    wake: (e) => wake(e),
    progress: (thread, stage) => progress(thread, stage),
  });
  /** An agent's screen starts in the agent's hands; the owner may take it to watch closely, type or sign in. */
  const control = (screen: number) => {
    let lease = leases.get(screen);
    if (!lease) {
      lease = computerControl();
      leases.set(screen, lease);
    }
    return lease;
  };
  const guest = guestOperations(store, config, control, touch);
  /** What the next start gives the VM; a disk already larger stays as it is, since Lima only grows one. */
  const resources = (): ComputerResources => {
    const wanted = resolveResources(store.settings.read("computer"), host);
    const disk = config.applied?.().disk_gib;
    return disk && disk > wanted.disk_gib ? { ...wanted, disk_gib: disk } : wanted;
  };
  /** Screens the VM holds at once, from the memory it runs with now (or will start with). */
  const cap = () => maxScreens(config.applied?.().memory_gib ?? resources().memory_gib);
  const ledger = screenLedger(store, {
    cap,
    ...(config.claimMs ? { claimMs: config.claimMs } : {}),
    screens: {
      start: async (screen, signal) => {
        await config.screens?.start(
          screen,
          appearance(),
          Object.values(store.settings.read("computer_screens")),
          signal,
        );
      },
      stop: async (screen) => {
        guest.closeScreen(screen);
        leases.get(screen)?.reset();
        await config.screens?.stop(screen);
      },
    },
  });
  /** An owner's native chat with no outside engine: the only kind a computer serves. */
  const nativeChat = (id: string) => {
    const t = store.threads.get(id);
    return t && NATIVE_CHATS.has(t.kind) && !t.engine && audienceOf(store, t).kind === "owner" ? t : undefined;
  };
  const running = async () => (config.lifecycle ? (await config.lifecycle.status()).phase === "running" : true);
  /** The screen a working run of an agent holds; refused for any other caller. */
  const held = (run: string) => {
    const claim = ledger.forRun(run);
    if (!claim) throw conflict("this run holds no screen on the computer; start it with the computer tool");
    return claim;
  };
  const vm = {
    async beforeDelete(ids: string[]) {
      const on = ids.filter((id) => chats().includes(id));
      if (!on.length) return;
      if (on.some((id) => ledger.forThread(id))) throw conflict("stop Computer before deleting its chat");
      store.settings.write(
        "computer_chats",
        chats().filter((id) => !on.includes(id)),
      );
    },
    /** The chat works on the computer: its agent's shell and browser run on its screen there. */
    hasThread: (id: string) => chats().includes(id),
    /** A chat a computer can serve: the owner's own, native, with no outside engine. */
    serves: (id: string) => Boolean(nativeChat(id)),
    /** Whether an agent may use the computer in a chat: the owner's grant, for good or for that chat. */
    permitted: (agent: string, id?: string) => store.approvals.allows(computerApproval, id, agent),
    /** The owner turns one agent's permission on or off for good; turning it off also ends grants for single chats. */
    permit(agent: string, on: boolean) {
      if (!store.agents.get(agent)) throw badRequest(`no agent ${agent}`);
      if (on) store.approvals.grant(computerApproval, "always", "", agent);
      else store.approvals.revokeAgent(computerApproval.key, agent);
      return { ok: true as const };
    },
    /** Set up once by the owner: from then on agents in their chats may ask to use it. */
    offered: () => Boolean(config.lifecycle) && store.settings.get("computer_enabled") === "true",
    /** Coming up now: work for the owner that keeps the Mac awake. */
    starting: () => config.lifecycle?.seen() === "preparing",
    /** The chat's agent gets a turn once the computer it started is up (or failed): it never waits in the chat. */
    whenReady: (thread: string, agent: string, now?: { setup?: boolean | undefined }) => ready.add(thread, agent, now),
    /**
     * A turn in a chat on the computer ended while the computer comes up (the owner started it, or the agent only
     * looked): the chat's agent gets its turn once it is ready, whatever it called, and takes its screen then.
     */
    afterTurn(thread: string, agent: string) {
      if (chats().includes(thread) && config.lifecycle?.seen() === "preparing") ready.add(thread, agent);
    },
    /** The owner canceled the chat's run: it no longer waits for the computer. */
    forgetWait: (thread: string) => ready.cancel(thread),
    /** How many chats wait for it to come up. */
    waiting: () => ready.waiting(),
    /** Who admits that turn (the engine, wired once it exists), and who shows the chat how far it got. */
    onReady(fn: (e: ReadyEvent) => void, stage: (thread: string, stage: ReadyStage) => void = () => {}) {
      wake = fn;
      progress = stage;
    },
    /** The visible browser on the screen this run holds. */
    browser: (run: string) => {
      touch();
      return guest.browser(held(run).screen);
    },
    resources,
    freeMemory,
    ledger,
    cap,
    /** Worth probing: never seen yet, or last seen running (an error may leave the guest up). */
    mayRun: () => {
      if (!config.lifecycle) return false;
      const seen = config.lifecycle.seen();
      return seen === undefined || seen === "running" || seen === "error";
    },
    /** `known`: what the core saw last, without asking the guest (a turn's briefing, every turn). */
    async status(forThread?: string, known = false) {
      const lifecycle = known ? config.lifecycle?.known() : await config.lifecycle?.status();
      const phaseOf: Partial<Awaited<ReturnType<VmLifecycle["status"]>>> =
        lifecycle ?? (known && !config.lifecycle ? { phase: "running" } : {});
      let ready = false;
      if (lifecycle) ready = lifecycle.phase === "running";
      // A lab or a test guest has no lifecycle: up as far as the core knows, without asking it.
      else if (known) ready = true;
      else
        try {
          const lines = await guest.exec(["list", "--json", config.instance]);
          ready = lines
            .split("\n")
            .filter(Boolean)
            .some((line) => (JSON.parse(line) as { status: string }).status === "Running");
        } catch {}
      const claims = ledger.claims();
      const up = ledger.running();
      const watched = guest.watched();
      const screen = (n: number) => {
        const claim = claims.find((c) => c.screen === n);
        const agent = claim?.agent ?? ledger.agentOf(n);
        return {
          screen: n,
          ...(agent ? { agent, agent_name: store.agents.get(agent)?.name ?? agent } : {}),
          ...(claim
            ? {
                thread: claim.thread,
                title: store.threads.get(claim.thread)?.title ?? "",
                run: claim.run,
                since: claim.at,
              }
            : {}),
          display: screenUser(n).display,
          ...control(n).status(),
          ...(watched.has(n) ? { watched: true } : {}),
        };
      };
      // Without a lifecycle (a lab or a test guest) screens count as up whenever claimed.
      const screens =
        ready || !config.lifecycle ? [...new Set([...up, ...claims.map((c) => c.screen)])].sort((a, b) => a - b) : [];
      const agent = forThread ? store.threads.get(forThread)?.agent_ids[0] : undefined;
      const mine = agent ? ledger.screenOf(agent) : undefined;
      const wanted = resources();
      const applied = config.applied?.() ?? {};
      const restart =
        ready &&
        (applied.memory_gib !== wanted.memory_gib ||
          applied.cpus !== wanted.cpus ||
          (applied.disk_gib ?? 0) < wanted.disk_gib);
      const stopped = store.settings.get("computer_last_stop");
      const allowed = store.agents
        .list()
        .filter((a) => store.approvals.allows(computerApproval, undefined, a.id))
        .map((a) => a.id);
      return {
        enabled: config.lifecycle ? Boolean(chats().length || vm.offered()) : true,
        ready,
        name: config.instance,
        chats: chats(),
        allowed_agents: allowed.length,
        allowed,
        screens: screens.map(screen),
        max_screens: cap(),
        ...(forThread && vm.serves(forThread)
          ? {
              chat: {
                thread: forThread,
                on: vm.hasThread(forThread),
                ...(agent
                  ? {
                      agent,
                      agent_name: store.agents.get(agent)?.name ?? agent,
                      permitted: vm.permitted(agent, forThread),
                    }
                  : {}),
                ...(mine !== undefined ? { screen: mine } : {}),
              },
            }
          : {}),
        workspace: AGENT_WORKSPACE,
        demo: config.demo === true,
        ...(config.model ? { model: config.model } : {}),
        resources: wanted,
        ...(ready && Object.keys(applied).length ? { running_resources: applied } : {}),
        limits: resourceLimits(host),
        ...(applied.disk_gib ? { disk_min_gib: applied.disk_gib } : {}),
        ...(restart ? { restart: true } : {}),
        idle_minutes: store.settings.read("computer").idle_minutes,
        ...(stopped ? { last_stop: JSON.parse(stopped) as { reason: StopReason; at: string } } : {}),
        ...phaseOf,
      };
    },
    /**
     * The run's screen, claimed now when the computer runs (a turn in a computer chat, or the agent starting it):
     * refused while its agent's screen works elsewhere or every screen is held.
     */
    async claim(agent: string, thread: string, run: string, signal?: AbortSignal) {
      if (!vm.hasThread(thread)) throw conflict("this chat does not work on the computer");
      if (!(await running())) return undefined;
      // A screen the owner has in hand, and up, is not given to its agent until they hand it back.
      const slot = ledger.slot(agent);
      const lease = control(slot);
      if (!ledger.running().has(slot)) lease.reset();
      else if (lease.status().control === "human")
        throw conflict("the owner has this agent's screen in hand; they hand it back from the computer's panel", {
          reason: "manual",
          screen: slot,
        });
      lease.assert("agent");
      // Use from the moment a screen is asked for, so the idle watchdog never stops it while it starts.
      touch();
      const claim = await ledger.claim(agent, thread, run, signal);
      touch();
      return claim;
    },
    release(run: string) {
      ledger.release(run);
    },
    /** The owner turns an allowed agent's screen on or off while the computer runs, with no run of the agent. */
    async screen(agent: string, on: boolean) {
      if (!store.agents.get(agent)) throw badRequest(`no agent ${agent}`);
      if (!(await running())) throw unavailable("the computer is off; turn it on first");
      if (on && !vm.permitted(agent))
        throw conflict(`${store.agents.get(agent)?.name ?? agent} may not use the computer`);
      touch();
      if (on) await ledger.up(agent);
      else await ledger.down(agent);
      return { ok: true as const };
    },
    humanControl: (screen: number) => control(screen).human(),
    /** The owner takes or returns one screen; taking an agent's cancels the run holding it. */
    async control(screen: number, mode: "agent" | "human", cancel: (thread: string) => number) {
      config.lifecycle?.assertRunning();
      await control(screen).change(mode, async () => {
        const claim = ledger.claims().find((c) => c.screen === screen);
        if (claim && mode === "human" && cancel(claim.thread))
          store.messages.add({
            thread_id: claim.thread,
            author: { kind: "agent", id: claim.agent },
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
        await guest.interrupt(screen);
      });
      touch();
      return { ok: true as const };
    },
    /** The owner starts the computer, putting a chat on it when named (its agent must be allowed first). */
    async enable(id: string | undefined, look: Appearance, pastReserve = false) {
      // The chat goes on the computer only once it can run: a start refused for memory leaves it on this Mac.
      if (id) vm.admit(id);
      store.settings.set("vm_appearance", look);
      await vm.boot(pastReserve);
      if (id) vm.bind(id);
      return { ok: true as const };
    },
    /** An allowed agent puts its chat on the computer, starts it if off, and takes its screen once it runs. */
    async start(id: string, agent: string, run: string) {
      vm.admit(id);
      if (await running()) {
        vm.bind(id);
        await vm.claim(agent, id, run);
        return { ok: true as const };
      }
      await vm.boot();
      vm.bind(id);
      return { ok: true as const };
    },
    /**
     * Starts the shared VM unless it runs, is starting, or free host memory cannot hold it with the host's reserve;
     * `pastReserve` (the owner's alone, from `environments.enable`) asks only for the VM's own memory.
     */
    async boot(pastReserve = false) {
      const lifecycle = config.lifecycle;
      if (!lifecycle) throw unavailable("this VM has no lifecycle controller");
      const now = await lifecycle.status();
      if (!now.supported) throw unavailable("Computer currently requires macOS Apple Silicon");
      if (now.phase === "running" || now.phase === "preparing") return;
      if (now.phase === "stopping") throw conflict("Computer is shutting down; start it again once it is off");
      const refusal = startRefusal(resources(), await freeMemory(), resourceLimits(host).memory_gib.min, pastReserve);
      if (refusal) throw conflict(refusalText(refusal), refusal);
      ledger.reset();
      for (const lease of leases.values()) lease.reset();
      touch();
      lifecycle.start(appearance());
      store.settings.set("computer_enabled", "true");
    },
    /** The chat goes back to this Mac; a screen it holds is let go (its desktop stays up until room is needed). */
    leave(id: string, run?: string) {
      const claim = ledger.forThread(id);
      if (claim && (!run || claim.run === run)) ledger.release(claim.run);
      store.settings.write(
        "computer_chats",
        chats().filter((chat) => chat !== id),
      );
      return { ok: true as const };
    },
    /** Shuts the shared VM down for everyone and keeps its disk; the reason is kept for the owner to read. */
    async halt(reason: StopReason, cancel: (thread: string) => void = () => {}) {
      if (!config.lifecycle) throw unavailable("this VM has no lifecycle controller");
      const holders = ledger.claims();
      // Stopped on purpose: whoever waited for it to come up is not woken to be told it did not.
      ready.cancel();
      config.lifecycle.stop();
      for (const lease of leases.values()) lease.reset();
      store.settings.set("computer_last_stop", JSON.stringify({ reason, at: new Date().toISOString() }));
      for (const claim of holders) cancel(claim.thread);
      ledger.reset();
      await guest.disconnect();
      return holders;
    },
    /** When the guest was last used: a command, a browser call, a viewer or a change of control. */
    lastActivity: () => Math.max(activity, guest.lastViewed()),
    watched: () => guest.watching(),
    /** Someone holds a screen, or the owner has one of the agents' screens in hand. */
    inUse: () =>
      ledger.pending() > 0 || ledger.claims().length > 0 || [...leases.values()].some((lease) => lease.human()),
    /** Every agent screen that is up follows APX's light or dark mode. */
    async appearance(look: Appearance) {
      const changed = store.settings.get("vm_appearance") !== look;
      store.settings.set("vm_appearance", look);
      if (changed && (await running()))
        await Promise.all([...ledger.running()].map((n) => config.screens?.appearance?.(n, look)));
      return { ok: true as const };
    },
    /** Refuses a chat the computer cannot serve: not the owner's native chat, or its agent not allowed. */
    admit(id: string) {
      const t = nativeChat(id);
      if (!t)
        throw badRequest(
          store.threads.get(id)?.kind === "home"
            ? "Home stays on this Mac; use the computer from another chat or a task"
            : "use an owner's native chat",
        );
      const agent = t.agent_ids[0];
      if (agent && !vm.permitted(agent, id))
        throw conflict(`${store.agents.get(agent)?.name ?? agent} may not use the computer; allow it first`);
    },
    /** Puts the chat on the computer; an agent's own run may do it from inside the chat. */
    bind(id: string) {
      vm.admit(id);
      if (!chats().includes(id)) store.settings.write("computer_chats", [...chats(), id]);
    },
    usage: async (): Promise<ComputerUsage | undefined> => config.usage?.(),
    /** The resource monitor's VM slot: the VM's numbers once the owner set it up, nothing on an install without one. */
    monitored: (): Promise<ComputerUsage | undefined> => {
      if (store.settings.get("computer_enabled") !== "true" && !chats().length) return Promise.resolve(undefined);
      // One probe for every caller, reused a few seconds: each one is a Lima call and an SSH read in the guest.
      if (!probe || Date.now() - probe.at > MONITOR_TTL_MS)
        probe = { at: Date.now(), value: Promise.resolve(config.usage?.()).catch(() => undefined) };
      return probe.value;
    },
    revokeDevice: guest.revokeDevice,
    display: (screen: number, device?: string) => {
      if (!ledger.running().has(screen) && !ledger.claims().some((c) => c.screen === screen))
        throw conflict("that screen is not running");
      return guest.display(screen, device);
    },
    connectDisplay: guest.connectDisplay,
    /** An agent's command runs on the screen its run holds; the owner's on the screen they name, in their hands. */
    async command(by: { run: string } | { screen: number }, command: string) {
      if (!(await running()))
        throw unavailable("the computer is stopped; start it with the computer tool or from Computer");
      if ("run" in by) return guest.command(held(by.run).screen, command, "agent");
      return guest.command(by.screen, command, "human");
    },
    async close() {
      ready.close();
      await Promise.all([guest.disconnect(true), config.lifecycle?.close()]);
    },
  };
  return vm;
}

export type Computer = ReturnType<typeof createComputer>;
