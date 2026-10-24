// The core's ledger of the shared computer's screens: which agent's working run holds which screen, kept in settings so
// a restart finds it, and swept of runs that are over. Each agent has one screen of its own (its Linux user and
// display); how many run at once is capped by the VM's memory (DECISIONS.md#d-152).
import { TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { conflict } from "../errors.ts";
import { MAX_SCREEN } from "./worker.ts";

export type Claim = { screen: number; agent: string; thread: string; run: string; at: string };

/** What a running screen costs the guest: its desktop, terminal and browser. The guest keeps 1 GiB for itself. */
export const SCREEN_GIB = 1.25;
export const maxScreens = (memoryGib: number) => Math.max(1, Math.floor((memoryGib - 1) / SCREEN_GIB));

export type ScreenStarter = {
  start(screen: number): Promise<void>;
  stop(screen: number): Promise<void>;
};

export function screenLedger(store: Store, o: { cap: () => number; screens: ScreenStarter }) {
  /** Desktops up in the guest; unknown after a restart until a claim starts one again (starting is idempotent). */
  const running = new Set<number>();
  /** Claims waiting for their screen to start: use, though not yet in the ledger. */
  let pending = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  const name = (agent: string) => store.agents.get(agent)?.name ?? agent;
  const write = (claims: Claim[]) => store.settings.write("computer_claims", claims);
  /** Claims whose run still works; the rest are dropped as they are found. */
  const claims = (): Claim[] => {
    const all = store.settings.read("computer_claims");
    const live = all.filter((c) => {
      const run = store.runs.get(c.run);
      return run && !TERMINAL.has(run.state);
    });
    if (live.length !== all.length) write(live);
    return live;
  };
  /** The agent's own screen number, given the first time it uses the computer. */
  const slot = (agent: string): number => {
    const screens = store.settings.read("computer_screens");
    const kept = screens[agent];
    if (kept) return kept;
    const used = new Set(Object.values(screens));
    let n = 1;
    while (used.has(n)) n++;
    if (n > MAX_SCREEN) throw conflict("the computer has no screen left for another agent");
    store.settings.write("computer_screens", { ...screens, [agent]: n });
    return n;
  };
  const ledger = {
    claims,
    slot,
    screenOf: (agent: string): number | undefined => store.settings.read("computer_screens")[agent],
    agentOf: (screen: number) =>
      Object.entries(store.settings.read("computer_screens")).find(([, n]) => n === screen)?.[0],
    forRun: (run: string) => claims().find((c) => c.run === run),
    forThread: (thread: string) => claims().find((c) => c.thread === thread),
    running: () => new Set(running),
    pending: () => pending,
    /**
     * Gives the agent's run its screen, starting its desktop. Refused while the agent's screen works for another chat,
     * or when every screen the VM can hold is held; a screen left running with no holder makes room.
     */
    claim: (agent: string, thread: string, run: string) => {
      pending++;
      return serial(async (): Promise<Claim> => {
        const now = claims();
        const own = now.find((c) => c.run === run);
        if (own) return own;
        const screen = slot(agent);
        const held = now.find((c) => c.screen === screen);
        if (held)
          throw conflict(
            `${name(agent)}'s screen is in use in another chat; it frees when that turn ends, or stop it there`,
          );
        if (!running.has(screen)) {
          const cap = o.cap();
          if (running.size >= cap) {
            const free = [...running].find((s) => !now.some((c) => c.screen === s));
            if (free === undefined)
              throw conflict(
                `all ${cap} screens the computer can hold are in use (${now.map((c) => name(c.agent)).join(", ")}); try again when one is done, or give the computer more memory`,
              );
            await o.screens.stop(free);
            running.delete(free);
          }
          await o.screens.start(screen);
          running.add(screen);
        }
        const claim = { screen, agent, thread, run, at: new Date().toISOString() };
        write([...claims(), claim]);
        return claim;
      }).finally(() => {
        pending--;
      });
    },
    /** The run is over or left the computer: its screen stays up for its next turn, until room is needed. */
    release(run: string) {
      const all = store.settings.read("computer_claims");
      const rest = all.filter((c) => c.run !== run);
      if (rest.length !== all.length) write(rest);
    },
    /** The VM stopped: no desktop is up and nobody holds a screen. */
    reset() {
      running.clear();
      write([]);
    },
    stopScreen: (screen: number) =>
      serial(async () => {
        await o.screens.stop(screen);
        running.delete(screen);
      }),
  };
  return ledger;
}
export type ScreenLedger = ReturnType<typeof screenLedger>;
