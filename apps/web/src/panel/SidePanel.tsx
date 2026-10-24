import { IconButton, Icons, ResizeHandle } from "@apx/ui";
import { type ReactNode, Suspense } from "react";
import { setPrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import {
  AgentPanel,
  BrowserPanel,
  ChangesPanel,
  ChatFiles,
  ComputerPanel,
  DocumentPanel,
  ProcessesPanel,
  TerminalPanel,
  UsagePanel,
  WidgetPanel,
} from "../lazy.ts";
import { LAYOUT } from "../shell/layout.ts";
import { go, nav, useNav } from "../shell/nav.ts";
import { useShellLayout } from "../shell/useShellLayout.ts";
import { coverNativeViews } from "./nativeCover.ts";
import { panelDef } from "./panels.tsx";
import { useWorkspace } from "./workspace.ts";

/** Right column next to the chat ("side panel"). The chat header's switcher picks its kind. */
export function SidePanel() {
  const t = useT();
  const panel = useNav((s) => s.panel);
  const wide = useNav((s) => s.panelWide);
  const ws = useWorkspace();
  const threadId = useNav((s) => s.threadId);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const layout = useShellLayout();
  if (!panel) return null;
  return (
    <aside className="sidepanel" aria-label={t("panel.side")}>
      {layout && !layout.compact && (
        <ResizeHandle
          edge="left"
          className="sidepanel__resize"
          width={layout.panelW}
          min={LAYOUT.panelMinW}
          max={layout.panelMaxW}
          // A dragged width replaces the wide toggle: one width at a time.
          onResize={(w) => {
            if (nav.get().panelWide) nav.set({ panelWide: false });
            setPrefs({ panelW: w });
          }}
          onReset={() => setPrefs({ panelW: 0 })}
          onDragChange={coverNativeViews}
          label={t("panel.resize")}
        />
      )}
      {panel === "computer" ? (
        <Suspense fallback={null}>
          <ComputerPanel key={threadId} />
        </Suspense>
      ) : panel === "browser" ? (
        <Suspense fallback={null}>
          <BrowserPanel />
        </Suspense>
      ) : panel === "processes" ? (
        <Suspense fallback={null}>
          <ProcessesPanel key={threadId} />
        </Suspense>
      ) : panel === "agent" ? (
        <Suspense fallback={null}>
          <AgentPanel />
        </Suspense>
      ) : panel === "changes" && thread ? (
        <Suspense fallback={null}>
          <ChangesPanel key={thread.id} thread={thread} ws={ws} />
        </Suspense>
      ) : (
        <>
          <PanelHeader
            actions={
              (panel === "files" || panel === "terminal" || panel === "changes" || panel === "document") && (
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
          {panel === "widget" && (
            <Suspense fallback={null}>
              <WidgetPanel />
            </Suspense>
          )}
          {panel === "document" && (
            <Suspense fallback={null}>
              <DocumentPanel />
            </Suspense>
          )}
          {panel === "usage" && (
            <Suspense fallback={null}>
              <UsagePanel />
            </Suspense>
          )}
          {thread && panel === "terminal" && (
            <Suspense fallback={null}>
              <TerminalPanel key={thread.id} thread={thread} />
            </Suspense>
          )}
          {thread && panel === "files" && (
            <Suspense fallback={null}>
              {/* The folder the chat's agent works in (with no project, APX's work folder) and its temp folder. */}
              <ChatFiles
                key={thread.id}
                thread={thread.id}
                root={ws?.folder}
                label={ws ? undefined : t("files.workFolder")}
                stacked={!wide}
              />
            </Suspense>
          )}
        </>
      )}
    </aside>
  );
}

/** 56px header: custom content (title or tab strip), optional actions, and close (not in a window of its own). */
export function PanelHeader({
  children,
  actions,
  closable = true,
}: {
  children: ReactNode;
  actions?: ReactNode;
  closable?: boolean;
}) {
  const t = useT();
  return (
    <header className="sidepanel__head">
      <div className="sidepanel__headmain">{children}</div>
      {actions}
      {closable && <IconButton label={t("panel.close")} icon={<Icons.X size={16} />} onClick={() => go.panel(null)} />}
    </header>
  );
}
