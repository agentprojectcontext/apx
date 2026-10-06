import type { TabInfo } from "@apx/protocol";
import { useEffect } from "react";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";
import { useBrowserPoppedOut } from "./browserWindow.ts";

/** The tab the panel shows: the one picked (or linked from a chat card), else the first. */
export function useActiveTab(): { tabs: TabInfo[]; active: TabInfo | undefined } {
  const tabs = useData((s) => s.tabs);
  const wanted = useNav((s) => s.browserTab);
  const active = tabs.find((t) => t.tab === wanted) ?? tabs[0];
  const activeId = active?.tab;
  const poppedOut = useBrowserPoppedOut();
  // In the desktop app the native view follows the panel's choice, again when the browser window hands it back.
  useEffect(() => {
    if (activeId && !poppedOut) window.apxDesktop?.showBrowserTab?.(activeId);
  }, [activeId, poppedOut]);
  return { tabs, active };
}
