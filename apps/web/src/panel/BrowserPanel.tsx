import "../styles/browser-panel.css";
import type { TabInfo } from "@apx/protocol";
import { EmptyState, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useEffect, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserClose, browserControl, loadTabs } from "../data/actions.ts";
import { useSlice } from "../data/createStore.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { nav } from "../shell/nav.ts";
import { BrowserEdit, leaveEditing } from "./BrowserEdit.tsx";
import { BrowserToolbar, HandoffBar } from "./BrowserToolbar.tsx";
import { BrowserViewport } from "./BrowserViewport.tsx";
import { browserEdit } from "./browserEdit.ts";
import { canPopOut, IS_BROWSER_WINDOW, openOutside, popOutBrowser, useInstalledBrowsers } from "./browserWindow.ts";
import { ControlLock } from "./ControlLock.tsx";
import { PanelTabs } from "./PanelTabs.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import { useActiveTab } from "./useActiveTab.ts";

/**
 * Browser panel: its tabs under the header, toolbar (back · reload · address · who drives), then the page. The desktop
 * app's browser window shows the same panel on its own.
 */
export function BrowserPanel() {
  const t = useT();
  const { tabs, active } = useActiveTab();
  const [adding, setAdding] = useState(false);
  const editing = useSlice(browserEdit, (s) => s.target);
  // Edit mode belongs to one tab the owner holds: another tab, or an agent taking it back, ends it.
  const editable = active && active.control.kind !== "agent" && active.control.kind !== "handoff";
  const inEdit = !adding && editable && editing === active.tab;

  useEffect(() => {
    void loadTabs();
  }, []);
  useEffect(() => {
    if (editing && !editing.startsWith("widget:") && !inEdit) void leaveEditing(editing);
  }, [editing, inEdit]);

  // Over the live page of the desktop app nothing can float: there the bar keeps the button.
  const locked = !adding && active?.control.kind === "agent" && !window.apxDesktop;
  return (
    <>
      <PanelHeader
        kind="browser"
        closable={!IS_BROWSER_WINDOW}
        widen={!IS_BROWSER_WINDOW}
        actions={
          <>
            {active && <OpenMenu tab={active} />}
            {IS_BROWSER_WINDOW && (
              <IconButton
                label={t("browser.backToPanel")}
                icon={<Icons.PanelRight size={15} />}
                onClick={() => popOutBrowser(false)}
              />
            )}
          </>
        }
      />
      <PanelTabs
        label={t("panel.browser")}
        tabs={tabs.map((x) => ({ id: x.tab, label: x.title || hostPath(x.url), dot: x.control.kind }))}
        value={adding ? undefined : active?.tab}
        onSelect={(id) => {
          setAdding(false);
          nav.set({ browserTab: id });
        }}
        onClose={(id) => void browserClose(id)}
        onNew={() => setAdding(true)}
        newLabel={t("browser.newTab")}
      />
      {active || adding ? (
        <div className="browser">
          <BrowserToolbar tab={adding ? undefined : active} onOpened={() => setAdding(false)} locked={locked} />
          {!adding && active?.control.kind === "handoff" && <HandoffBar tab={active} />}
          {adding || !active ? (
            <EmptyState icon={<Icons.Globe />} title={t("browser.newTab")}>
              {t("browser.newTabHint")}
            </EmptyState>
          ) : inEdit ? (
            <BrowserEdit tab={active} />
          ) : (
            <div className="browser__stage">
              <BrowserViewport tab={active.tab} />
              {locked && active.control.kind === "agent" && <BrowserLock tab={active} by={active.control.by} />}
            </div>
          )}
        </div>
      ) : (
        <div className="sidepanel__body">
          <EmptyState icon={<Icons.Globe />} title={t("browser.noTabs")}>
            {t("browser.noTabsBody")}
          </EmptyState>
        </div>
      )}
    </>
  );
}

/** The agent drives the tab: its page dimmed behind who it is and "Take control". */
function BrowserLock({ tab, by }: { tab: TabInfo; by: string }) {
  const t = useT();
  const agent = useData((s) => s.agents[by]);
  const [busy, setBusy] = useState(false);
  const name = agent?.name ?? by;
  return (
    <ControlLock
      agent={name}
      blob={blobOf(agent)}
      text={t("browser.agentUsing", { name })}
      hint={t("panelTabs.browserHint")}
      action={t("browser.takeControl")}
      busy={busy}
      onTake={async () => {
        setBusy(true);
        await browserControl(tab.tab, "user");
        setBusy(false);
      }}
    />
  );
}

/** Where else to see the page: APX's own window, the system's default browser or an installed one. */
function OpenMenu({ tab }: { tab: TabInfo }) {
  const t = useT();
  const browsers = useInstalledBrowsers();
  const items: MenuEntry[] = [
    ...(canPopOut()
      ? [
          { label: t("browser.openWindow"), icon: <Icons.AppWindow size={14} />, onSelect: () => popOutBrowser(true) },
          { type: "separator" as const },
        ]
      : []),
    { label: t("browser.openDefault"), icon: <Icons.Globe size={14} />, onSelect: () => openOutside(tab.url) },
    ...browsers.map((b) => ({
      label: t("browser.openIn", { name: b.name }),
      onSelect: () => openOutside(tab.url, b.id),
    })),
  ];
  return (
    <Menu
      trigger={<IconButton label={t("browser.openMenu")} icon={<Icons.ExternalLink size={15} />} />}
      items={items}
    />
  );
}
