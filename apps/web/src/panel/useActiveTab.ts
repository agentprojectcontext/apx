import type { TabInfo } from "@apx/protocol";
import { useEffect } from "react";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";

/** The tab the panel shows: the one picked (or linked from a chat card), else the first. */
export function useActiveTab(): { tabs: TabInfo[]; active: TabInfo | undefined } {
  const tabs = useData((s) => s.tabs);
  const wanted = useNav((s) => s.browserTab);
  const active = tabs.find((t) => t.tab === wanted) ?? tabs[0];
  const activeId = active?.tab;
  // In the desktop app the native view follows the panel's choice.
  useEffect(() => {
    if (activeId) window.apxDesktop?.showBrowserTab?.(activeId);
  }, [activeId]);
  return { tabs, active };
}
