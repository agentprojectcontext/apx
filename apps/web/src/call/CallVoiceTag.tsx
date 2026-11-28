import type { Thread } from "@apx/protocol";
import { Tag } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { voiceChip } from "./callChip.ts";

/** In a call's header: which phone it went through. */
export function CallVoiceTag({ thread }: { thread: Pick<Thread, "kind" | "call"> }) {
  const t = useT();
  const chip = voiceChip(thread);
  return chip ? <Tag>{t(chip.key, { device: chip.device })}</Tag> : null;
}
