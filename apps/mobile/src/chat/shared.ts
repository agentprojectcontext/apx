// Files shared in chats as the phone shows them: each as a media item the viewer and the share sheet know. Pure, so
// node:test covers it.
import type { SharedFile, SharedKind } from "../protocol";
import type { MediaItem } from "./media";

export type SharedFilter = SharedKind | "all";

/** The filters, in the order the page shows them. */
export const SHARED_FILTERS: readonly SharedFilter[] = ["all", "image", "video", "audio", "document"];

/** The media item for a shared file; one without a name of its own is named after its kind. */
export function sharedItem(file: SharedFile, unnamed: string): MediaItem {
  return {
    key: `${file.message_id}:${file.media_id}`,
    kind: file.kind === "document" ? "file" : file.kind,
    media_id: file.media_id,
    mime: file.mime,
    name: file.name || unnamed,
    bytes: file.bytes,
  };
}

/** How many there are under a filter: all of them, or one kind's. */
export function sharedCount(counts: Record<SharedKind, number> | undefined, filter: SharedFilter): number | undefined {
  if (!counts) return undefined;
  return filter === "all" ? counts.image + counts.video + counts.audio + counts.document : counts[filter];
}
