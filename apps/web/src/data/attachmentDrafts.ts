import type { Attached } from "./composer.ts";

/** Session-only files: never serialize local URLs or uploaded media references into browser storage. */
export type AttachmentChip = {
  key: string;
  name: string;
  image: boolean;
  preview?: string;
  media?: Attached;
  error?: string;
};

export function attachmentDraft() {
  let chips: AttachmentChip[] = [];
  let active = true;
  const listeners = new Set<() => void>();
  const update = (next: AttachmentChip[]) => {
    chips = next;
    for (const listener of listeners) listener();
  };
  const release = (gone: AttachmentChip[]) => {
    for (const chip of gone) if (chip.preview) URL.revokeObjectURL(chip.preview);
  };
  return {
    snapshot: () => chips,
    active: () => active,
    discard: () => {
      active = false;
      release(chips);
      update([]);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add: (fresh: AttachmentChip[]) => {
      if (active) update([...chips, ...fresh]);
      else release(fresh);
    },
    patch: (key: string, patch: Partial<AttachmentChip>) =>
      update(chips.map((chip) => (chip.key === key ? { ...chip, ...patch } : chip))),
    remove: (key: string) => {
      release(chips.filter((chip) => chip.key === key));
      update(chips.filter((chip) => chip.key !== key));
    },
    take: (): Attached[] => {
      const ready = chips.flatMap((chip) => (chip.media ? [chip.media] : []));
      release(chips);
      update([]);
      return ready;
    },
  };
}

const drafts = new Map<string, ReturnType<typeof attachmentDraft>>();

export function discardAttachments(chat: string): void {
  drafts.get(chat)?.discard();
  drafts.delete(chat);
}

/** A draft outlives its composer, so pending uploads settle in their original chat even while it is closed. */
export function attachmentsOf(chat: string) {
  let draft = drafts.get(chat);
  if (!draft) {
    draft = attachmentDraft();
    drafts.set(chat, draft);
  }
  return draft;
}
