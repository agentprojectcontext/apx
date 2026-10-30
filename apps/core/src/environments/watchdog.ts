import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Computer } from "./computer.ts";
import { gib, STOP_BELOW_GIB } from "./resources.ts";

const GIB = 1024 ** 3;

const SAID = {
  memory: (free: number) =>
    `Computer was shut down: this machine had only ${gib(free)} GiB of memory free. Its disk is kept; start it again when there is room.`,
  idle: (minutes: number) =>
    `Computer was shut down after ${minutes} minutes without use, to free its memory. Its disk is kept; it starts again when needed.`,
};

/**
 * Stops the shared computer for everyone when the host runs short of memory, or once no agent holds a screen and
 * nothing used it for the owner's idle minutes (no viewer, no agent screen in the owner's hands). It keeps the disk
 * and tells the owner why, in the tray and in each chat whose screen it took.
 */
export function computerWatchdog(o: {
  store: Store;
  vm: Pick<Computer, "status" | "halt" | "lastActivity" | "watched" | "mayRun" | "inUse">;
  freeMemory: () => Promise<number>;
  /** Ends a turn holding a screen when the computer stops under it, as the owner's shutdown does. */
  cancel?: (thread: string) => void;
  everyMs?: number;
  now?: () => number;
  onError?: (message: string) => void;
}) {
  const now = o.now ?? Date.now;
  let checking: Promise<void> | undefined;
  const tell = (threads: string[], text: string, vars: Record<string, string>) => {
    for (const thread of new Set(threads)) {
      const agent = o.store.threads.get(thread)?.agent_ids[0];
      if (agent)
        o.store.messages.add({
          thread_id: thread,
          author: { kind: "agent", id: agent },
          parts: [{ type: "notice", level: "info", code: "computer.stopped", vars, text }],
        });
    }
    o.store.notifications.add({
      kind: "run",
      level: "warn",
      title: "Computer",
      body: text,
      ...(threads[0] ? { thread_id: threads[0] } : {}),
    });
  };
  const check = async () => {
    if (!o.vm.mayRun()) return;
    const status = await o.vm.status();
    if (status.phase !== "running") return;
    const free = await o.freeMemory();
    if (free < STOP_BELOW_GIB * GIB) {
      const holders = await o.vm.halt("memory", o.cancel);
      return tell(
        holders.map((c) => c.thread),
        SAID.memory(free),
        { variant: "memory", free: gib(free) },
      );
    }
    const minutes = o.store.settings.read("computer").idle_minutes;
    if (!minutes || o.vm.inUse() || o.vm.watched()) return;
    if (now() - o.vm.lastActivity() < minutes * 60_000) return;
    await o.vm.halt("idle", o.cancel);
    tell([], SAID.idle(minutes), { variant: "idle", minutes: String(minutes) });
  };
  const tick = () => {
    checking ??= check()
      .catch((error: unknown) => o.onError?.(errorMessage(error)))
      .finally(() => {
        checking = undefined;
      });
    return checking;
  };
  const timer = setInterval(() => void tick(), o.everyMs ?? 30_000);
  timer.unref();
  return {
    tick,
    async stop() {
      clearInterval(timer);
      await checking;
    },
  };
}
