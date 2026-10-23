import { secureRequestKey } from "@apx/protocol/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Attached, isImage, mimeOf, transcribe, upload } from "../../data/composer.ts";

/** One file in the composer: uploading, ready to send, or refused (with the reason). */
export type Chip = {
  key: string;
  name: string;
  image: boolean;
  /** Local preview of an image, until the message is sent. */
  preview?: string;
  media?: Attached;
  error?: string;
};

const MAX = 8;

/** The files waiting to go with the next message; each uploads as soon as it is added. */
export function useAttachments(thread: string | undefined, onWords?: (text: string) => void) {
  const [chips, setChips] = useState<Chip[]>([]);
  const live = useRef(chips);
  live.current = chips;
  const alive = useRef(true);
  const words = useRef(onWords);
  words.current = onWords;
  // Previews are object URLs: freed when their chip goes, and when the chat changes.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const c of live.current) if (c.preview) URL.revokeObjectURL(c.preview);
    };
  }, []);

  const patch = useCallback(
    (key: string, p: Partial<Chip>) => setChips((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c))),
    [],
  );

  const add = useCallback(
    (files: Iterable<File>) => {
      const room = MAX - live.current.length;
      const fresh = [...files].slice(0, Math.max(0, room)).map((file) => {
        const image = isImage(mimeOf(file));
        const chip: Chip = {
          key: secureRequestKey(),
          name: file.name || "pasted",
          image,
          ...(image ? { preview: URL.createObjectURL(file) } : {}),
        };
        upload(file, thread).then(
          async (media) => {
            const text = media.kind === "audio" ? await transcribe(media.id, thread) : undefined;
            if (!alive.current || !live.current.some((c) => c.key === chip.key)) return;
            patch(chip.key, { media });
            if (text) words.current?.(text);
          },
          (e: unknown) => patch(chip.key, { error: e instanceof Error ? e.message : String(e) }),
        );
        return chip;
      });
      // The ref moves at once: a drop and a paste in the same tick share the room left.
      live.current = [...live.current, ...fresh];
      if (fresh.length) setChips((cs) => [...cs, ...fresh]);
    },
    [thread, patch],
  );

  const remove = useCallback((key: string) => {
    setChips((cs) => {
      const gone = cs.find((c) => c.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return cs.filter((c) => c.key !== key);
    });
  }, []);

  /** Hands over what is ready and empties the strip; the sent message shows the stored files instead. */
  const take = useCallback((): Attached[] => {
    const ready = live.current.flatMap((c) => (c.media ? [c.media] : []));
    for (const c of live.current) if (c.preview) URL.revokeObjectURL(c.preview);
    live.current = [];
    setChips([]);
    return ready;
  }, []);

  /** Puts back files a failed send took (already uploaded: they need no new upload). */
  const restore = useCallback((files: Attached[]) => {
    const back = files.map((media) => ({
      key: media.id,
      name: media.name,
      image: media.kind === "image",
      media,
    }));
    live.current = [...back, ...live.current];
    setChips((cs) => [...back, ...cs]);
  }, []);

  const uploading = chips.some((c) => !c.media && !c.error);
  const ready = chips.some((c) => c.media);
  return { chips, add, remove, take, restore, uploading, ready, full: chips.length >= MAX };
}
