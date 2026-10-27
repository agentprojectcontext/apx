import { secureRequestKey } from "@apx/protocol/client";
import { useCallback, useSyncExternalStore } from "react";
import { type AttachmentChip, attachmentsOf } from "../../data/attachmentDrafts.ts";
import { type Attached, isImage, mimeOf, tooBig, transcribe, upload } from "../../data/composer.ts";
import { draftOf, keepDraft } from "../../data/drafts.ts";

export type Chip = AttachmentChip;
const MAX = 8;

/** The files waiting to go with the next message; navigation does not cancel or restart their uploads. */
export function useAttachments(chat: string, thread: string | undefined) {
  const draft = attachmentsOf(chat);
  const chips = useSyncExternalStore(draft.subscribe, draft.snapshot);

  const add = useCallback(
    (files: Iterable<File>) => {
      const room = MAX - draft.snapshot().length;
      const fresh = [...files].slice(0, Math.max(0, room)).map((file) => {
        const image = isImage(mimeOf(file));
        const chip: Chip = {
          key: secureRequestKey(),
          name: file.name || "pasted",
          image,
          ...(image && !tooBig(file) ? { preview: URL.createObjectURL(file) } : {}),
        };
        return { file, chip };
      });
      draft.add(fresh.map(({ chip }) => chip));
      for (const { file, chip } of fresh) {
        void upload(file, thread)
          .then(async (media) => {
            if (!draft.snapshot().some((c) => c.key === chip.key)) return;
            const text = media.kind === "audio" ? await transcribe(media.id, thread) : undefined;
            if (!draft.snapshot().some((c) => c.key === chip.key)) return;
            draft.patch(chip.key, { media });
            if (text) {
              const previous = draftOf(chat);
              keepDraft(chat, previous.trim() ? `${previous.trimEnd()} ${text}` : text);
            }
          })
          .catch((e: unknown) => draft.patch(chip.key, { error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [chat, thread, draft],
  );

  /** Failed sends restore references, not uploads; their originating draft remains safe after navigation. */
  const restore = useCallback(
    (files: Attached[]) => {
      const existing = new Set(draft.snapshot().flatMap((chip) => (chip.media ? [chip.media.id] : [])));
      draft.add(
        files
          .filter((media) => !existing.has(media.id))
          .map((media) => ({
            key: media.id,
            name: media.name,
            image: media.kind === "image",
            media,
          })),
      );
    },
    [draft],
  );

  const uploading = chips.some((c) => !c.media && !c.error);
  const ready = chips.some((c) => c.media);
  return {
    chips,
    add,
    remove: draft.remove,
    take: draft.take,
    restore,
    active: draft.active,
    uploading,
    ready,
    full: chips.length >= MAX,
  };
}
