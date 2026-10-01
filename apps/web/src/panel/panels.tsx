import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import type { PanelKind } from "../shell/nav.ts";

export type PanelDef = { id: PanelKind; label: string; icon: (size: number) => ReactNode };

/** Side panel types, in the chat header order (SPEC §2.4 panel switcher). */
export const PANELS: PanelDef[] = [
  { id: "browser", label: "Navegador", icon: (s) => <Icons.Globe size={s} /> },
  { id: "terminal", label: "Terminal", icon: (s) => <Icons.Terminal size={s} /> },
  { id: "files", label: "Archivos", icon: (s) => <Icons.FileText size={s} /> },
  { id: "widget", label: "Widget", icon: (s) => <Icons.LayoutGrid size={s} /> },
  { id: "usage", label: "Consumo", icon: (s) => <Icons.Zap size={s} /> },
];

export function panelDef(id: PanelKind): PanelDef {
  return PANELS.find((p) => p.id === id) ?? (PANELS[0] as PanelDef);
}
