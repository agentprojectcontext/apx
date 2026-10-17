import type { CoreEvent, DocumentSource, Message, Part } from "@apx/protocol";

export type DocumentPart = Extract<Part, { type: "file" }> & {
  document: NonNullable<Extract<Part, { type: "file" }>["document"]>;
};

/** What a document panel needs to show one: from a chat's message, or from `documents.list`. */
export type DocRef = {
  media_id: string;
  name: string;
  title: string;
  format: "markdown" | "text";
  /** The file it was read from, in the chat's folder (older documents do not say). */
  source?: DocumentSource;
};

export const docRef = (part: DocumentPart): DocRef => ({
  media_id: part.media_id,
  name: part.name,
  title: part.document.title,
  format: part.document.format,
  ...(part.document.source && { source: part.document.source }),
});

/**
 * A chat's documents, newest first: the ones in its loaded messages, then those only the core still has (a long chat
 * loads its latest messages, not the old ones a document may be in).
 */
export function withStored(loaded: DocumentPart[], stored: readonly DocRef[]): DocRef[] {
  const seen = new Set(loaded.map((p) => p.media_id));
  return [...loaded.map(docRef), ...stored.filter((d) => !seen.has(d.media_id))];
}

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
