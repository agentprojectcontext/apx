// The owner's computer, as a node, when they turned computer use on in the desktop app: a picture of the screen and
// a click or typing on the app in front. The core only routes; the desktop checks the app is still the one approved.
// The emergency stop (the desktop says so) ends the turns that were using the computer: only those, only that time.
import { COMPUTER_CAP } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { saveUpload } from "../services/uploads.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

/** Reading the accessibility tree of a busy window takes a few seconds. */
const SNAPSHOT_MS = 20_000;
const ACT_MS = 10_000;
/** A real click may wait up to 20 s for the owner's mouse to rest (the desktop gives up at 25 s). */
const CLICK_MS = 30_000;

/** A turn that used the computer this recently counts as using it when the owner pulls the stop. */
const ACTIVE_MS = 10 * 60_000;

export function computerHandlers(
  broker: NodeBroker,
  store: Store,
  home: string,
  engine: { cancel(thread: string): number },
  /** Whether a chat works on the shared Linux computer: its agent's screen is there, never the owner's. */
  onComputer: (thread: string) => boolean = () => false,
) {
  /** The turns using the computer now (run → its chat, last use), and those the owner stopped. */
  const using = new Map<string, { thread: string; at: number }>();
  const stopped = new Set<string>();

  broker.onEvent((node, event) => {
    if (event.type !== "computer.stopped" || !node.caps.includes(COMPUTER_CAP)) return;
    const now = Date.now();
    for (const [run, u] of using) {
      if (now - u.at > ACTIVE_MS) continue;
      stopped.add(run);
      engine.cancel(u.thread);
    }
    using.clear();
  });

  /** A computer call from an agent's turn: refused if the owner stopped that turn; remembered for the stop. */
  const enter = (ctx: CallContext) => {
    const a = ctx.agent;
    if (!a) return;
    // Started on the Mac, a turn may move to the Linux computer midway: from then on the owner's screen is not its own.
    if (onComputer(a.thread_id))
      throw new CallError({
        code: "conflict",
        message:
          "this chat works on your Linux computer now: the screen tools see and act on the owner's Mac, not your screen. Use browser_snapshot for a page, and shell on your screen for the rest",
      });
    if (stopped.has(a.run_id))
      throw new CallError({
        code: "conflict",
        message:
          "the owner pulled the emergency stop on this turn: do not use the computer again in it; say so and end the turn",
      });
    using.set(a.run_id, { thread: a.thread_id, at: Date.now() });
  };

  return {
    "computer.snapshot": async ({ thread, app, note }, ctx) => {
      enter(ctx);
      const ask = { ...(app ? { app } : {}), ...(note ? { note } : {}) };
      const r = (await broker.invoke(COMPUTER_CAP, "computer.snapshot", ask, SNAPSHOT_MS)) as {
        mime?: string;
        data?: string;
        app?: string;
        window?: string;
        elements?: string;
      };
      if (!r?.data || !r.mime) throw new CallError({ code: "conflict", message: "no picture of the screen came back" });
      const m = saveUpload(home, store, {
        name: "screen.jpg",
        mime: r.mime,
        bytes: Buffer.from(r.data, "base64"),
        ...(thread ? { thread } : {}),
      });
      return {
        media: { id: m.id, mime: m.mime },
        app: String(r.app ?? ""),
        window: String(r.window ?? ""),
        elements: String(r.elements ?? "").slice(0, 12_000),
      };
    },
    "computer.click": async (p, ctx) => {
      enter(ctx);
      return (await broker.invoke(COMPUTER_CAP, "computer.click", p, CLICK_MS)) as { app: string; how?: string };
    },
    "computer.type": async (p, ctx) => {
      enter(ctx);
      return (await broker.invoke(COMPUTER_CAP, "computer.type", p, ACT_MS)) as { app: string };
    },
    "computer.key": async (p, ctx) => {
      enter(ctx);
      return (await broker.invoke(COMPUTER_CAP, "computer.key", p, ACT_MS)) as { app: string };
    },
    "computer.open": async (p, ctx) => {
      enter(ctx);
      if (!p.url && !p.app) throw new CallError({ code: "bad_request", message: "say a url, an app, or both" });
      // An app that was closed takes a few seconds to start and show its window.
      return (await broker.invoke(COMPUTER_CAP, "computer.open", p, ACT_MS + 8_000)) as { app: string; where?: string };
    },
  } satisfies Partial<Handlers>;
}
