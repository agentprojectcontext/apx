// The core's ledger of the shared computer's screens: which agent's working run holds which screen, kept in settings so
// a restart finds it, and swept of runs that are over. Each agent has one screen of its own (its Linux user and
// display); how many run at once is capped by the VM's memory (DECISIONS.md#d-152).
import { TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { conflict, unavailable } from "../errors.ts";
import { MAX_SCREEN } from "./worker.ts";

export type Claim = { screen: number; agent: string; thread: string; run: string; at: string };

/** What a running screen costs the guest: its desktop, terminal and browser. The guest keeps 1 GiB for itself. */
export const SCREEN_GIB = 1.25;
export const maxScreens = (memoryGib: number) => Math.max(1, Math.floor((memoryGib - 1) / SCREEN_GIB));

export type ScreenStarter = {
  start(screen: number, signal: AbortSignal): Promise<void>;
  stop(screen: number): Promise<void>;
};

/** Longest a claim may take, queue included: a screen that does not start by then fails its turn, not every turn. */
export const CLAIM_MS = 90_000;

/** Settles when the signal aborts, with its reason. */
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

export function screenLedger(store: Store, o: { cap: () => number; screens: ScreenStarter; claimMs?: number }) {
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
    claim: (agent: string, thread: string, run: string, signal?: AbortSignal) => {
      pending++;
      const late = unavailable(`${name(agent)}'s screen did not start in time; try again`);
      const deadline = AbortSignal.timeout(o.claimMs ?? CLAIM_MS);
      const limit = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const reason = () => (deadline.aborted ? late : limit.reason);
      // Bookkeeping stays one at a time (the cap counts every screen), but no claim holds the queue past its deadline.
      const work = serial(async (): Promise<Claim> => {
        if (limit.aborted) throw reason();
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
          await Promise.race([o.screens.start(screen, limit), aborted(limit)]).catch((error: unknown) => {
            throw limit.aborted ? reason() : error;
          });
          running.add(screen);
        }
        const claim = { screen, agent, thread, run, at: new Date().toISOString() };
        write([...claims(), claim]);
        return claim;
      });
      return Promise.race([work, aborted(limit).catch(() => Promise.reject(reason()))]).finally(() => {
        pending--;
      });
    },
    /**
     * The owner turns an agent's screen on with no run: to watch it, take it in hand, sign in somewhere. It never takes
     * another screen's place: past the cap it is refused, naming the screens that are up.
     */
    up: (agent: string, signal?: AbortSignal) => {
      const deadline = AbortSignal.timeout(o.claimMs ?? CLAIM_MS);
      const limit = signal ? AbortSignal.any([signal, deadline]) : deadline;
      return serial(async (): Promise<number> => {
        const screen = slot(agent);
        if (running.has(screen)) return screen;
        const cap = o.cap();
        if (running.size >= cap) {
          const up = [...running].map((s) => name(ledger.agentOf(s) ?? ""));
          throw conflict(`all ${cap} screens the computer can hold are up (${up.join(", ")})`, {
            reason: "screens_full",
            max: cap,
            up,
          });
        }
        await Promise.race([o.screens.start(screen, limit), aborted(limit)]).catch((error: unknown) => {
          throw deadline.aborted ? unavailable(`${name(agent)}'s screen did not start in time; try again`) : error;
        });
        running.add(screen);
        return screen;
      });
    },
    /** The owner turns an agent's screen off, giving its memory back: not while a run of it works there. */
    down: (agent: string) =>
      serial(async () => {
        const screen = store.settings.read("computer_screens")[agent];
        if (screen === undefined || !running.has(screen)) return;
        if (claims().some((c) => c.screen === screen))
          throw conflict(`${name(agent)} is working on its screen; stop that turn first`);
        await o.screens.stop(screen);
        running.delete(screen);
      }),
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
