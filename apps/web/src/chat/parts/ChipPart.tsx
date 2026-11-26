import type { Part } from "@apx/protocol";
import { ActionGroup, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { chipItems, type ResearchField } from "./chip-items.ts";

const FIELD: Record<ResearchField, { icon: ReactNode; key: MessageKey }> = {
  interests: { icon: <Icons.Tag />, key: "chip.research.interest" },
  projects: { icon: <Icons.Folder />, key: "chip.research.project" },
  pages: { icon: <Icons.Globe />, key: "chip.research.page" },
  places: { icon: <Icons.MapPin />, key: "chip.research.place" },
  // A chip saved before places were a list.
  location: { icon: <Icons.MapPin />, key: "chip.research.place" },
};

/** "Saved to memory ›", "Research updated ›": one small line that opens to what was saved or added. */
export function ChipPart({ code, parts }: { code: string; parts: readonly Part[] }) {
  const t = useT();
  const memory = code === "memory.saved";
  const items = chipItems(parts, code).map(({ field, text }) =>
    field
      ? { name: t(FIELD[field].key, { value: text }), icon: FIELD[field].icon }
      : { name: text, icon: <Icons.Brain /> },
  );
  return (
    <ActionGroup
      className="turn__tools turn__chip"
      icon={memory ? <Icons.Brain size={14} /> : <Icons.Search size={14} />}
      title={t(memory ? "notice.memory.saved" : "notice.research.updated")}
      items={items}
    />
  );
}
