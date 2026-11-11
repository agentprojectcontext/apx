import type { MailMark } from "@apx/protocol";
import { partOfMedia } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { untrusted } from "../tools/result.ts";

/** A marked mail's tag, in English (the app shows its own words by the notice's code). */
const MARK_TEXT: Record<MailMark, string> = {
  automatic: "Automatic: no person wrote it",
  spam: "Spam",
  unverified: "Unverified sender",
  blocked: "Never read",
  outside: "Outside who may write",
};

/** Unanswered words remain visible and available as outside context, without starting a turn. */
export function quietMessage(store: Store) {
  return (
    threadId: string,
    channel: string,
    person: { id: string; name: string; muted?: boolean } | undefined,
    text: string,
    attachments: string[] = [],
    note?: Record<string, string>,
    history?: {
      at?: string | undefined;
      historical?: boolean;
      deferEvent?: boolean;
      /** Kept for the owner only (marked mail): shown with this tag, never in the agent's context. */
      mark?: MailMark | undefined;
    },
  ): string =>
    store.tx(() => {
      const kept = store.messages.add({
        thread_id: threadId,
        author: person ? { kind: "person", id: person.id, name: person.name, channel } : { kind: "user" },
        via: channel,
        ...(history?.at ? { at: history.at } : {}),
        quiet: history?.deferEvent === true,
        parts: [
          { type: "text", text },
          ...attachments.flatMap((id) => {
            const m = store.media.get(id);
            return m ? [partOfMedia(m)] : [];
          }),
          ...(history?.mark
            ? [
                {
                  type: "notice" as const,
                  level: "info" as const,
                  code: `mail.${history.mark}`,
                  text: MARK_TEXT[history.mark],
                },
              ]
            : []),
        ],
      });
      if (!history?.mark) {
        const why: Record<string, string> =
          note ?? (person?.muted ? { silenced: "yes" } : { answered: "no, it needed no answer" });
        store.modelLog.append(threadId, undefined, [
          {
            role: "user",
            content: person ? untrusted("channel_message", { from: person.name, channel, ...why }, text) : text,
            images: attachments.flatMap((id) => {
              const m = store.media.get(id);
              return m?.kind === "image" ? [{ media_id: id, mime: m.mime }] : [];
            }),
          },
        ]);
      }
      const t = store.threads.get(threadId);
      if (!history?.historical || !t?.preview)
        store.threads.patch(threadId, {
          preview: previewOf(text),
          // Marked mail waits in its list without counting as something to read.
          ...(person && !history?.historical && !history?.mark ? { unread: (t?.unread ?? 0) + 1 } : {}),
        });
      return kept.id;
    });
}
