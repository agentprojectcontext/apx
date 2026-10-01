import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import type { MessageKey } from "../i18n/index.ts";
import type { PanelKind } from "../shell/nav.ts";

export type PanelDef = { id: PanelKind; label: MessageKey; icon: (size: number) => ReactNode };

/** Side panel types, in the chat header order (SPEC §2.4 panel switcher). */
export const PANELS: PanelDef[] = [
  { id: "browser", label: "panel.browser", icon: (s) => <Icons.Globe size={s} /> },
  { id: "terminal", label: "panel.terminal", icon: (s) => <Icons.Terminal size={s} /> },
  { id: "files", label: "panel.files", icon: (s) => <Icons.FileText size={s} /> },
  { id: "widget", label: "panel.widget", icon: (s) => <Icons.LayoutGrid size={s} /> },
  { id: "usage", label: "panel.usage", icon: (s) => <Icons.Zap size={s} /> },
];

export function panelDef(id: PanelKind): PanelDef {
  return PANELS.find((p) => p.id === id) ?? (PANELS[0] as PanelDef);
}
