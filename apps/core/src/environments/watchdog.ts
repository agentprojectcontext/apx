import { TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Computer } from "./computer.ts";
import { gib, STOP_BELOW_GIB } from "./resources.ts";

const GIB = 1024 ** 3;

const SAID = {
  memory: (free: number) =>
    `Computer was shut down: this Mac had only ${gib(free)} GiB of memory free. Its disk is kept; start it again when there is room.`,
  idle: (minutes: number) =>
    `Computer was shut down after ${minutes} minutes without use, to free its memory. Its disk is kept; it starts again when needed.`,
};

/**
 * Stops a running computer when the host runs short of memory, or when nothing used it for the owner's idle minutes
 * (no working run in its chat, nobody watching, the agent in control). It keeps the disk and tells the owner why.
 */
export function computerWatchdog(o: {
  store: Store;
  vm: Pick<Computer, "status" | "halt" | "lastActivity" | "watched" | "mayRun">;
  freeMemory: () => Promise<number>;
  everyMs?: number;
  now?: () => number;
  onError?: (message: string) => void;
}) {
  const now = o.now ?? Date.now;
  let checking: Promise<void> | undefined;
  const tell = (thread: string, text: string, vars: Record<string, string>) => {
    const agent = o.store.threads.get(thread)?.agent_ids[0];
    if (agent)
      o.store.messages.add({
        thread_id: thread,
        author: { kind: "agent", id: agent },
        parts: [{ type: "notice", level: "info", code: "computer.stopped", vars, text }],
      });
    o.store.notifications.add({ kind: "run", level: "warn", title: "Computer", body: text, thread_id: thread });
  };
  const check = async () => {
    if (!o.vm.mayRun()) return;
    const status = await o.vm.status();
    if (status.phase !== "running" || !status.thread) return;
    const thread = status.thread;
    const free = await o.freeMemory();
    if (free < STOP_BELOW_GIB * GIB) {
      await o.vm.halt("memory");
      return tell(thread, SAID.memory(free), { variant: "memory", free: gib(free) });
    }
    const minutes = o.store.settings.read("computer").idle_minutes;
    if (!minutes || status.control === "human" || o.vm.watched()) return;
    const runs = o.store.runs.list(thread);
    if (runs.some((run) => !TERMINAL.has(run.state))) return;
    const ended = Math.max(0, ...runs.map((run) => Date.parse(run.ended_at ?? run.started_at) || 0));
    if (now() - Math.max(o.vm.lastActivity(), ended) < minutes * 60_000) return;
    await o.vm.halt("idle");
    tell(thread, SAID.idle(minutes), { variant: "idle", minutes: String(minutes) });
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
