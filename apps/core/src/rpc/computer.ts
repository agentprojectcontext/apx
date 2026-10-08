// The owner's computer, as a node, when they turned computer use on in the desktop app: a picture of the screen and
// a click or typing on the app in front. The core only routes; the desktop checks the app is still the one approved.
import { COMPUTER_CAP } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { saveUpload } from "../services/uploads.ts";
import type { Handlers } from "./router.ts";

/** Reading the accessibility tree of a busy window takes a few seconds. */
const SNAPSHOT_MS = 20_000;
const ACT_MS = 10_000;

export function computerHandlers(broker: NodeBroker, store: Store, home: string) {
  return {
    "computer.snapshot": async ({ thread, app }) => {
      const r = (await broker.invoke(COMPUTER_CAP, "computer.snapshot", app ? { app } : {}, SNAPSHOT_MS)) as {
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
    "computer.click": async (p) => (await broker.invoke(COMPUTER_CAP, "computer.click", p, ACT_MS)) as { app: string },
    "computer.type": async (p) => (await broker.invoke(COMPUTER_CAP, "computer.type", p, ACT_MS)) as { app: string },
  } satisfies Partial<Handlers>;
}
