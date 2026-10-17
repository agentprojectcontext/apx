// A confirmation or question sent to a channel stops asking there once it is settled: answered in the app or in
// another chat, its message is taken out; answered in that same chat or expired, it only loses its buttons.
import type { InputState } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { ChannelAdapter } from "./types.ts";

/** Inputs already closed, remembered so a later update of the same card does nothing (bounded). */
const REMEMBER = 500;

export function createInputCards(deps: {
  store: Store;
  log: Log;
  /** The channel's adapter while it runs. */
  running(channel: string): ChannelAdapter | undefined;
}) {
  const answered = new Map<string, { at: string; by: "button" | "text" }>();
  const closed = new Set<string>();
  const key = (channel: string, conversation: string) => `${channel}\n${conversation}`;

  return {
    answeredHere(inputId: string, at: { channel: string; conversation: string }, by: "button" | "text"): void {
      answered.set(inputId, { at: key(at.channel, at.conversation), by });
    },
    settled(inputId: string, state: InputState): void {
      if (state === "pending" || closed.has(inputId)) return;
      if (closed.size >= REMEMBER) closed.clear();
      closed.add(inputId);
      const here = answered.get(inputId);
      answered.delete(inputId);
      for (const o of deps.store.channels.outbox.forInput(inputId)) {
        if (o.state !== "sent" || !o.external_id) continue;
        const sameChat = here?.at === key(o.channel, o.conversation);
        // A pressed button already took the keyboard off its own message.
        if (sameChat && here?.by === "button") continue;
        const adapter = deps.running(o.channel);
        if (!adapter) continue;
        const ref = o.external_id;
        const unbutton = async () => adapter.setButtons?.(o.conversation, ref, []);
        // An older message the platform will not delete keeps its words and loses its buttons.
        const close =
          sameChat || state === "expired" || !adapter.remove
            ? unbutton()
            : adapter.remove(o.conversation, ref).catch(unbutton);
        close.catch((err: unknown) => {
          deps.log.warn({ channel: o.channel, input: inputId, err: errorMessage(err, 200) }, "input card not closed");
        });
      }
    },
  };
}
