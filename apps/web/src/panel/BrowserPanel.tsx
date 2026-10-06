import type { TabInfo } from "@apx/protocol";
import { BrowserTabs, EmptyState, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useEffect, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserClose, loadTabs } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { nav } from "../shell/nav.ts";
import { BrowserToolbar, HandoffBar } from "./BrowserToolbar.tsx";
import { BrowserViewport } from "./BrowserViewport.tsx";
import { canPopOut, IS_BROWSER_WINDOW, openOutside, popOutBrowser, useInstalledBrowsers } from "./browserWindow.ts";
import { PanelHeader } from "./SidePanel.tsx";
import { useActiveTab } from "./useActiveTab.ts";

/**
 * Browser panel: tab strip in the header, toolbar (back · reload · address · who drives), then the page. The desktop
 * app's browser window shows the same panel on its own.
 */
export function BrowserPanel() {
  const t = useT();
  const { tabs, active } = useActiveTab();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadTabs();
  }, []);

  return (
    <>
      <PanelHeader
        closable={!IS_BROWSER_WINDOW}
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
      >
        <BrowserTabs
          value={adding ? undefined : active?.tab}
          onValueChange={(id) => {
            setAdding(false);
            nav.set({ browserTab: id });
          }}
          onClose={(id) => void browserClose(id)}
          onNew={() => setAdding(true)}
          newLabel={t("browser.newTab")}
          closeLabel={t("browser.closeTab")}
          tabs={tabs.map((x) => ({ id: x.tab, title: x.title || hostPath(x.url), url: x.url, holder: x.control.kind }))}
        />
      </PanelHeader>
      {active || adding ? (
        <div className="browser">
          <BrowserToolbar tab={adding ? undefined : active} onOpened={() => setAdding(false)} />
          {!adding && active?.control.kind === "handoff" && <HandoffBar tab={active} />}
          {adding || !active ? (
            <EmptyState icon={<Icons.Globe />} title={t("browser.newTab")}>
              {t("browser.newTabHint")}
            </EmptyState>
          ) : (
            <BrowserViewport tab={active.tab} />
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
