import type { Thread } from "@apx/protocol";
import { stickerPreviewNeedsSource, stickerPreviewText } from "@apx/protocol/sticker-display";
import { useEffect } from "react";
import { loadThread } from "./actions.ts";
import { useData } from "./state.ts";

/** Any capped opening tag can also be a literal caption: resolve that ambiguity from the original message. */
export function useThreadPreview(thread: Thread | undefined): string {
  const preview = thread?.preview ?? "";
  const messages = useData((s) => (thread ? s.messages[thread.id] : undefined));
  const load = useData((s) => (thread ? s.threadLoad[thread.id] : undefined));
  const needsSource = stickerPreviewNeedsSource(preview);
  const source = needsSource
    ? messages
        ?.toReversed()
        .flatMap((m) => m.parts)
        .find((p) => p.type === "text" && p.text.startsWith(preview))
    : undefined;
  useEffect(() => {
    if (thread && needsSource && !messages && !load) void loadThread(thread.id);
  }, [thread, needsSource, messages, load]);
  return stickerPreviewText(preview, source?.type === "text" ? source.text : "");
}
