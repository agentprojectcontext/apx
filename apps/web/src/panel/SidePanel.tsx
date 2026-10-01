import { IconButton, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { go, useNav } from "../shell/nav.ts";
import { BrowserPanel } from "./BrowserPanel.tsx";
import { PlaceholderPanel } from "./PlaceholderPanel.tsx";
import { panelDef } from "./panels.tsx";
import { UsagePanel } from "./UsagePanel.tsx";
import { WidgetPanel } from "./WidgetPanel.tsx";

/** Right column next to the chat ("Panel lateral"). The chat header's switcher picks its kind. */
export function SidePanel() {
  const panel = useNav((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="sidepanel" aria-label="Panel lateral">
      {panel === "browser" ? (
        <BrowserPanel />
      ) : (
        <>
          <PanelHeader>
            <span className="sidepanel__title">
              {panelDef(panel).icon(14)}
              {panelDef(panel).label}
            </span>
          </PanelHeader>
          {panel === "widget" && <WidgetPanel />}
          {panel === "usage" && <UsagePanel />}
          {panel === "terminal" && (
            <PlaceholderPanel icon={<Icons.Terminal />} title="Terminal">
              La terminal llega con las sesiones de código.
            </PlaceholderPanel>
          )}
          {panel === "files" && (
            <PlaceholderPanel icon={<Icons.FileText />} title="Archivos">
              Acá vas a ver los archivos que cambió el agente en esta sesión.
            </PlaceholderPanel>
          )}
        </>
      )}
    </aside>
  );
}

/** 56px header: custom content (title or tab strip), optional actions, and close. */
export function PanelHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sidepanel__head">
      <div className="sidepanel__headmain">{children}</div>
      {actions}
      <IconButton label="Cerrar panel" icon={<Icons.X size={16} />} onClick={() => go.panel(null)} />
    </header>
  );
}
