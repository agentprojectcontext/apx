import type { TabInfo } from "@apx/protocol";
import { useEffect, useState } from "react";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";
import { useBrowserPoppedOut } from "./browserWindow.ts";

/** The picked tab (or the first) and whether its actual browser lives in this desktop app. */
export function useActiveTab(): { tabs: TabInfo[]; active: TabInfo | undefined; native: boolean } {
  const tabs = useData((s) => s.tabs);
  const wanted = useNav((s) => s.browserTab);
  const active = tabs.find((t) => t.tab === wanted) ?? tabs[0];
  const activeId = active?.tab;
  const [localId, setLocalId] = useState<string>();
  const native = activeId !== undefined && activeId === localId;
  const poppedOut = useBrowserPoppedOut();
  useEffect(() => {
    const check = window.apxDesktop?.hasBrowserView;
    if (!activeId || !check) return;
    let live = true;
    void check(activeId).then(
      (has) => live && setLocalId(has ? activeId : undefined),
      () => live && setLocalId(undefined),
    );
    return () => {
      live = false;
    };
  }, [activeId]);
  useEffect(() => {
    if (activeId && native && !poppedOut) window.apxDesktop?.showBrowserTab?.(activeId);
  }, [activeId, native, poppedOut]);
  return { tabs, active, native };
}
