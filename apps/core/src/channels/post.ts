// What an agent (or the owner) writes on a channel outside a turn's answer: kept in the chat, then sent through the
// outbox. Used for a contact's chat and for a public room.
import type { Thread } from "@apx/protocol";
import type { Presentation } from "../domain/channels.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import type { createDelivery } from "./delivery.ts";

/** What an agent's message on a channel left: the chat it went to and how that chat ended before it. */
export type Posted = {
  thread: string;
  channel: string;
  /** Its outbox item: how the send went. */
  outbox: string;
  recent: Array<{ from: "them" | "you" | "owner"; text: string }>;
};

export function createPoster(store: Store, delivery: Pick<ReturnType<typeof createDelivery>, "enqueue">) {
  /** The end of a chat as plain lines, so an agent writing there knows what was already said. */
  function recentOf(threadId: string): Posted["recent"] {
    return store.messages.list(threadId, 6).flatMap((m) => {
      const said = m.parts
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n")
        .trim();
      if (!said) return [];
      const from = m.author.kind === "person" ? "them" : m.author.kind === "user" ? "owner" : "you";
      return [{ from, text: said.slice(0, 300) } as const];
    });
  }

  /** Kept in the chat (and, `logged`, in what its agent reads), then sent through the outbox; returns its item's id. */
  function post(
    thread: Thread,
    channel: string,
    conversation: string,
    text: string,
    o: {
      by?: string | undefined;
      files?: string[] | undefined;
      logged: boolean;
      mentions?: Presentation["mentions"];
      omit_signature?: boolean | undefined;
    },
  ): string {
    const files = (o.files ?? []).map((id) => {
      const m = store.media.get(id);
      if (!m) throw new Error(`no file ${id}`);
      return m;
    });
    const sent = store.tx(() => {
      const m = store.messages.add({
        thread_id: thread.id,
        author: o.by ? { kind: "agent", id: o.by } : { kind: "user", direct: true },
        parts: [
          { type: "text", text },
          ...files.map((f) =>
            f.kind === "image"
              ? ({ type: "image", media_id: f.id, mime: f.mime, alt: f.prompt ?? "image" } as const)
              : ({ type: "file", media_id: f.id, name: f.prompt ?? f.id, mime: f.mime, bytes: f.bytes } as const),
          ),
        ],
      });
      if (o.logged) store.modelLog.append(thread.id, undefined, [{ role: "assistant", content: text }]);
      store.threads.patch(thread.id, { preview: previewOf(text) });
      return m;
    });
    return delivery.enqueue({
      channel,
      conversation,
      thread_id: thread.id,
      message_id: sent.id,
      kind: "reply",
      body: {
        text,
        ...(o.omit_signature !== undefined ? { omit_signature: o.omit_signature } : {}),
        ...(o.mentions?.length ? { mentions: o.mentions } : {}),
        ...(files.length
          ? {
              media: files.map((f) => ({
                id: f.id,
                kind: f.kind,
                mime: f.mime,
                ...(f.kind === "file" && f.prompt ? { name: f.prompt } : {}),
              })),
            }
          : {}),
      },
    });
  }

  return { post, recentOf };
}
