import { IconButton, Icons } from "@apx/ui";
import { lazy, type ReactNode, Suspense } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { AgentPanel } from "./AgentPanel.tsx";
import { BrowserPanel } from "./BrowserPanel.tsx";
import { PlaceholderPanel } from "./PlaceholderPanel.tsx";
import { panelDef } from "./panels.tsx";
import { WidgetPanel } from "./WidgetPanel.tsx";
import { useWorkspace } from "./workspace.ts";

// The folder's panels load when first opened, not with the chat.
const FilesPane = lazy(() => import("../project/files/FilesPane.tsx").then((m) => ({ default: m.FilesPane })));
const UsagePanel = lazy(() => import("./UsagePanel.tsx").then((m) => ({ default: m.UsagePanel })));
const ChangesPanel = lazy(() => import("./ChangesPanel.tsx").then((m) => ({ default: m.ChangesPanel })));
const ProcessesPanel = lazy(() => import("./ProcessesPanel.tsx").then((m) => ({ default: m.ProcessesPanel })));
const ReportedChangesPanel = lazy(() =>
  import("./ReportedChangesPanel.tsx").then((m) => ({ default: m.ReportedChangesPanel })),
);
const TerminalPanel = lazy(() => import("./TerminalPanel.tsx").then((m) => ({ default: m.TerminalPanel })));

/** Right column next to the chat ("side panel"). The chat header's switcher picks its kind. */
export function SidePanel() {
  const t = useT();
  const panel = useNav((s) => s.panel);
  const wide = useNav((s) => s.panelWide);
  const ws = useWorkspace();
  const threadId = useNav((s) => s.threadId);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  if (!panel) return null;
  const folder = panelDef(panel).folder;
  return (
    <aside className="sidepanel" aria-label={t("panel.side")}>
      {panel === "browser" ? (
        <BrowserPanel />
      ) : panel === "processes" ? (
        <Suspense fallback={null}>
          <ProcessesPanel key={threadId} />
        </Suspense>
      ) : panel === "agent" ? (
        <AgentPanel />
      ) : (
        <>
          <PanelHeader
            actions={
              (folder || panel === "terminal" || panel === "changes") && (
                <IconButton
                  label={wide ? t("panel.narrow") : t("panel.widen")}
                  icon={wide ? <Icons.Minimize2 size={14} /> : <Icons.Maximize2 size={14} />}
                  onClick={() => go.togglePanelWide()}
                />
              )
            }
          >
            <span className="sidepanel__title">
              {panelDef(panel).icon(14)}
              {t(panelDef(panel).label)}
            </span>
          </PanelHeader>
          {panel === "widget" && <WidgetPanel />}
          {panel === "usage" && (
            <Suspense fallback={null}>
              <UsagePanel />
            </Suspense>
          )}
          {folder && !ws && (
            <PlaceholderPanel icon={panelDef(panel).icon(20)} title={t("panel.noFolder")}>
              {t("panel.noFolderBody")}
            </PlaceholderPanel>
          )}
          {thread && panel === "terminal" && (
            <Suspense fallback={null}>
              <TerminalPanel key={thread.id} thread={thread} ws={ws} />
            </Suspense>
          )}
          {thread && panel === "changes" && (
            <Suspense fallback={null}>
              {ws ? <ChangesPanel key={thread.id} ws={ws} /> : <ReportedChangesPanel thread={thread} />}
            </Suspense>
          )}
          {ws && folder && (
            <Suspense fallback={null}>
              {panel === "files" && <FilesPane key={ws.project.id} project={ws.project} stacked={!wide} />}
            </Suspense>
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
