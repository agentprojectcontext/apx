// The answer the owner sees for one run: a message whose parts are added and replaced as the turn goes, in the order
// things happened. Text comes in segments: once a card (a tool, an approval, a widget) lands after it, what the model
// says next starts a new text part below that card instead of rewriting the one above. When the owner's words reach
// the turn while it works, what follows goes in a message of its own below theirs: the chat keeps the order.
import type { Message, Part } from "@apx/protocol";
import type { Store } from "../domain/store.ts";

const TEXT_THROTTLE_MS = 120;

export type Display = ReturnType<typeof openDisplay>;

export function openDisplay(store: Store, message: Message) {
  let current = message;
  /** This run's messages above the current one, whose cards (a delegation, a job) may still change. */
  const earlier: Message[] = [];
  let lastText = 0;
  let pendingText: string | undefined;
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  /** The text part being written; undefined until the model says something, and again once a card follows it. */
  let segment: number | undefined;

  const setAt = (index: number, part: Part) => {
    const parts = [...current.parts];
    parts[index] = part;
    current = { ...current, parts };
    store.messages.setPart(current, index);
  };
  const writeText = (text: string) => {
    pendingText = undefined;
    lastText = Date.now();
    if (segment === undefined) {
      if (!text) return;
      segment = current.parts.length;
    }
    setAt(segment, { type: "text", text });
  };
  const flush = () => {
    if (textTimer) clearTimeout(textTimer);
    textTimer = undefined;
    if (pendingText !== undefined) writeText(pendingText);
  };
  const upsert = (match: (p: Part) => boolean, part: Part) => {
    const i = current.parts.findIndex(match);
    if (i >= 0) return setAt(i, part);
    for (const [at, m] of earlier.entries()) {
      const j = m.parts.findIndex(match);
      if (j < 0) continue;
      const parts = [...m.parts];
      parts[j] = part;
      earlier[at] = { ...m, parts };
      return store.messages.setPart(earlier[at], j);
    }
    // A new card closes the text above it: what streamed so far is written first, so it stays above the card.
    flush();
    segment = undefined;
    setAt(current.parts.length, part);
  };

  return {
    get message() {
      return current;
    },
    upsert,
    /** A card of this run's answer, in whichever of its messages it is. */
    find(match: (p: Part) => boolean): Part | undefined {
      return current.parts.find(match) ?? earlier.flatMap((m) => m.parts).find(match);
    },
    /**
     * The owner's words just reached the turn: what it says next goes in a new message, below theirs. A message
     * still empty has nothing to keep above them and is taken out.
     */
    below(): Message {
      flush();
      const next = store.messages.add({
        thread_id: current.thread_id,
        author: current.author,
        parts: [],
        ...(current.run_id ? { run_id: current.run_id } : {}),
        ...(current.model ? { model: current.model } : {}),
      });
      if (current.parts.length) earlier.push(current);
      else store.messages.drop(current.thread_id, [current.id]);
      current = next;
      segment = undefined;
      return next;
    },
    /** Streaming text: at most one update every ~120 ms; the last value is never lost. */
    text(soFar: string) {
      if (Date.now() - lastText >= TEXT_THROTTLE_MS) return writeText(soFar);
      pendingText = soFar;
      textTimer ??= setTimeout(() => {
        textTimer = undefined;
        if (pendingText !== undefined) writeText(pendingText);
      }, TEXT_THROTTLE_MS);
    },
    /** Final text: replaces what the last segment streamed (or adds it, when no segment says it already). */
    finalText(text: string) {
      if (textTimer) clearTimeout(textTimer);
      textTimer = undefined;
      pendingText = undefined;
      if (segment === undefined && current.parts.some((p) => p.type === "text" && p.text === text)) return;
      writeText(text);
    },
    notice(
      level: "info" | "warn" | "error",
      code: string,
      text: string,
      extra?: { vars?: Record<string, string | number>; detail?: string },
    ) {
      upsert((p) => p.type === "notice" && p.code === code, { type: "notice", level, code, text, ...extra });
    },
    setModel(model: string) {
      if (current.model === model) return;
      current = store.messages.update({ ...current, model });
    },
    close: flush,
  };
}
