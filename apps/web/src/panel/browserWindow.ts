// The desktop app can show the browser in a window of its own (this panel loaded with ?browser). While it is open,
// the main window's side panel keeps the tabs and the toolbar but points at that window instead of the page.
import { useEffect, useState } from "react";
import { createStore, useSlice } from "../data/createStore.ts";
import { nav } from "../shell/nav.ts";

/** This page is the browser window itself. */
const query = new URLSearchParams(window.location.search);
export const IS_BROWSER_WINDOW = query.has("browser");
// It opens on the tab the side panel was showing.
if (IS_BROWSER_WINDOW && query.get("tab")) nav.set({ browserTab: query.get("tab") ?? undefined });

const desktop = typeof window !== "undefined" ? window.apxDesktop : undefined;
const popout = createStore({ open: !IS_BROWSER_WINDOW && desktop?.browserPoppedOut?.() === true });
desktop?.onBrowserPopout?.((open) => popout.set({ open }));

/** The browser is in its own window (always false inside that window). */
export function useBrowserPoppedOut(): boolean {
  return useSlice(popout, (s) => s.open) && !IS_BROWSER_WINDOW;
}

export const canPopOut = (): boolean => Boolean(desktop?.popOutBrowser) && !IS_BROWSER_WINDOW;

export function popOutBrowser(open: boolean): void {
  desktop?.popOutBrowser?.(open);
}

/** The browsers installed on this computer, asked once per page. */
let installed: Promise<Array<{ id: string; name: string }>> | undefined;
export function useInstalledBrowsers(): Array<{ id: string; name: string }> {
  const [list, setList] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!desktop?.installedBrowsers) return;
    installed ??= desktop.installedBrowsers().catch(() => []);
    let live = true;
    void installed.then((l) => live && setList(Array.isArray(l) ? l : []));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** The desktop app hands it to the system (default or a named browser); a plain web panel opens a new tab. */
export function openOutside(url: string, browser?: string): void {
  if (desktop?.openExternal) void desktop.openExternal(url, browser);
  else window.open(url, "_blank", "noopener,noreferrer");
}
