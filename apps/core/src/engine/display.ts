// The answer the owner sees for one run: a message whose parts are added and replaced as the turn goes.
import type { Message, Part } from "@apx/protocol";
import type { Store } from "../domain/store.ts";

const TEXT_THROTTLE_MS = 120;

export type Display = ReturnType<typeof openDisplay>;

export function openDisplay(store: Store, message: Message) {
  let current = message;
  let lastText = 0;
  let pendingText: string | undefined;
  let textTimer: ReturnType<typeof setTimeout> | undefined;

  const upsert = (match: (p: Part) => boolean, part: Part) => {
    const parts = [...current.parts];
    const i = parts.findIndex(match);
    const index = i >= 0 ? i : parts.length;
    parts[index] = part;
    current = { ...current, parts };
    store.messages.setPart(current, index);
  };
  const writeText = (text: string) => {
    pendingText = undefined;
    lastText = Date.now();
    upsert((p) => p.type === "text", { type: "text", text });
  };

  return {
    get message() {
      return current;
    },
    upsert,
    /** Streaming text: at most one update every ~120 ms; the last value is never lost. */
    text(soFar: string) {
      if (Date.now() - lastText >= TEXT_THROTTLE_MS) return writeText(soFar);
      pendingText = soFar;
      textTimer ??= setTimeout(() => {
        textTimer = undefined;
        if (pendingText !== undefined) writeText(pendingText);
      }, TEXT_THROTTLE_MS);
    },
    /** Final text: replaces whatever streamed. */
    finalText(text: string) {
      if (textTimer) clearTimeout(textTimer);
      textTimer = undefined;
      writeText(text);
    },
    notice(level: "info" | "warn" | "error", code: string, text: string) {
      upsert((p) => p.type === "notice" && p.code === code, { type: "notice", level, code, text });
    },
    setModel(model: string) {
      if (current.model === model) return;
      current = store.messages.update({ ...current, model });
    },
    close() {
      if (textTimer) clearTimeout(textTimer);
      textTimer = undefined;
      if (pendingText !== undefined) writeText(pendingText);
    },
  };
}
