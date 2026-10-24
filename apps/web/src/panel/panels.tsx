import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import type { MessageKey } from "../i18n/index.ts";
import type { PanelKind } from "../shell/nav.ts";

export type PanelDef = {
  id: PanelKind;
  label: MessageKey;
  hint: MessageKey;
  icon: (size: number) => ReactNode;
};

/** Side panel types, in the chat header order (SPEC §2.4 panel switcher). */
export const PANELS: PanelDef[] = [
  { id: "computer", label: "panel.computer", hint: "panel.computer.hint", icon: (s) => <Icons.Monitor size={s} /> },
  { id: "browser", label: "panel.browser", hint: "panel.browser.hint", icon: (s) => <Icons.Globe size={s} /> },
  { id: "document", label: "panel.document", hint: "panel.document.hint", icon: (s) => <Icons.FileText size={s} /> },
  {
    id: "terminal",
    label: "panel.terminal",
    hint: "panel.terminal.hint",
    icon: (s) => <Icons.Terminal size={s} />,
  },
  {
    id: "files",
    label: "panel.files",
    hint: "panel.files.hint",
    icon: (s) => <Icons.FolderTree size={s} />,
  },
  {
    id: "changes",
    label: "panel.changes",
    hint: "panel.changes.hint",
    icon: (s) => <Icons.FileDiff size={s} />,
  },
  { id: "processes", label: "panel.processes", hint: "panel.processes.hint", icon: (s) => <Icons.Users size={s} /> },
  { id: "widget", label: "panel.widget", hint: "panel.widget.hint", icon: (s) => <Icons.LayoutGrid size={s} /> },
  { id: "usage", label: "panel.usage", hint: "panel.usage.hint", icon: (s) => <Icons.Zap size={s} /> },
];

export function panelDef(id: PanelKind): PanelDef {
  return PANELS.find((p) => p.id === id) ?? (PANELS[0] as PanelDef);
}
