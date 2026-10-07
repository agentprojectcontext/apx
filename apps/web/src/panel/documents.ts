import type { CoreEvent, Message, Part } from "@apx/protocol";

export type DocumentPart = Extract<Part, { type: "file" }> & {
  document: NonNullable<Extract<Part, { type: "file" }>["document"]>;
};

export function isDocument(part: Part): part is DocumentPart {
  return part.type === "file" && part.document !== undefined;
}

/** Newest first, scoped to the current chat; a reload never opens another chat's document. */
export function chatDocuments(messages: Message[], thread: string): DocumentPart[] {
  return messages
    .filter((m) => m.thread_id === thread)
    .flatMap((m) => m.parts.filter(isDocument))
    .reverse();
}

/** Only an explicit tool presentation in the visible chat opens the panel, never an edit or history reload. */
export function documentToOpen(event: CoreEvent, thread: string | undefined): DocumentPart | undefined {
  return event.type === "message.part" && event.thread_id === thread && isDocument(event.part) ? event.part : undefined;
}
