// The owner's messages their agent has not taken yet: send one now or take it back, or change or move one in line.
import type { Message } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { data, upsertMessage } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The chat's messages in line for the agent's next turn, in the order they will run. */
export const inLine = (messages: readonly Message[]): Message[] =>
  messages.filter((m) => m.waiting?.until === "turn").sort((a, b) => a.seq - b.seq);

function keep(threadId: string, messages: Message[]): void {
  data.set((s) => ({
    messages: { ...s.messages, [threadId]: messages.reduce(upsertMessage, s.messages[threadId] ?? []) },
  }));
}

/** The agent takes it at once: the step in progress stops, or an outside engine's turn does and this one runs. */
export async function sendNow(message: Message): Promise<void> {
  try {
    await client.call("runs.send_now", { message: message.id });
  } catch (e) {
    notify(t("waiting.error", { error: errText(e) }));
  }
}

export async function editInLine(message: Message, text: string): Promise<boolean> {
  const run = message.waiting?.run;
  if (!run) return false;
  try {
    const r = await client.call("runs.update_queued", { run, text });
    keep(message.thread_id, [r.message]);
    return true;
  } catch (e) {
    notify(t("waiting.error", { error: errText(e) }));
    return false;
  }
}

/** Takes a message back before the agent reads it, whether sent into its turn or in line: out of the chat too. */
export async function unsend(message: Message): Promise<void> {
  try {
    await client.call("runs.unsend", { message: message.id });
    data.set((s) => ({
      messages: {
        ...s.messages,
        [message.thread_id]: (s.messages[message.thread_id] ?? []).filter((m) => m.id !== message.id),
      },
    }));
  } catch (e) {
    notify(t("waiting.error", { error: errText(e) }));
  }
}

/** Moves one message in line a place up (-1) or down (+1). */
export async function moveInLine(line: readonly Message[], message: Message, by: -1 | 1): Promise<void> {
  const at = line.findIndex((m) => m.id === message.id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= line.length) return;
  const order = [...line];
  [order[at], order[to]] = [order[to] as Message, order[at] as Message];
  const runs = order.flatMap((m) => (m.waiting?.run ? [m.waiting.run] : []));
  try {
    const r = await client.call("runs.reorder", { thread: message.thread_id, runs });
    keep(message.thread_id, r.messages);
  } catch (e) {
    notify(t("waiting.error", { error: errText(e) }));
  }
}
