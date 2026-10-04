import { IconButton, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { AgentPanel } from "./AgentPanel.tsx";
import { BrowserPanel } from "./BrowserPanel.tsx";
import { PlaceholderPanel } from "./PlaceholderPanel.tsx";
import { panelDef } from "./panels.tsx";
import { UsagePanel } from "./UsagePanel.tsx";
import { WidgetPanel } from "./WidgetPanel.tsx";

/** Right column next to the chat ("side panel"). The chat header's switcher picks its kind. */
export function SidePanel() {
  const t = useT();
  const panel = useNav((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="sidepanel" aria-label={t("panel.side")}>
      {panel === "browser" ? (
        <BrowserPanel />
      ) : panel === "agent" ? (
        <AgentPanel />
      ) : (
        <>
          <PanelHeader>
            <span className="sidepanel__title">
              {panelDef(panel).icon(14)}
              {t(panelDef(panel).label)}
            </span>
          </PanelHeader>
          {panel === "widget" && <WidgetPanel />}
          {panel === "usage" && <UsagePanel />}
          {panel === "terminal" && (
            <PlaceholderPanel icon={<Icons.Terminal />} title={t("panel.terminal")}>
              {t("panel.terminalSoon")}
            </PlaceholderPanel>
          )}
          {panel === "files" && (
            <PlaceholderPanel icon={<Icons.FileText />} title={t("panel.files")}>
              {t("panel.filesSoon")}
            </PlaceholderPanel>
          )}
        </>
      )}
    </aside>
  );
}

/** 56px header: custom content (title or tab strip), optional actions, and close. */
export function PanelHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const t = useT();
  return (
    <header className="sidepanel__head">
      <div className="sidepanel__headmain">{children}</div>
      {actions}
      <IconButton label={t("panel.close")} icon={<Icons.X size={16} />} onClick={() => go.panel(null)} />
    </header>
  );
}
