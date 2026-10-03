// Sandboxed preload for APX's own pages (the panel and the quick chat): the few things the web UI asks of the shell.
import { contextBridge, ipcRenderer } from "electron";

type Bounds = { x: number; y: number; width: number; height: number };

contextBridge.exposeInMainWorld("apxDesktop", {
  setBrowserBounds: (b: Bounds | null) => ipcRenderer.send("panel:browser-bounds", b),
  showBrowserTab: (tab: string) => ipcRenderer.send("panel:browser-tab", tab),
  openMain: (threadId?: string) =>
    ipcRenderer.send("quick:open-main", typeof threadId === "string" ? threadId : undefined),
  onOpenThread: (listener: (threadId: string) => void) =>
    ipcRenderer.on("nav:thread", (_e, id: unknown) => {
      if (typeof id === "string") listener(id);
    }),
  applyDesktopPrefs: (prefs: { shortcut: string; launchAtLogin: boolean }) => ipcRenderer.send("desktop:prefs", prefs),
  setAttention: (unread: number) => ipcRenderer.send("desktop:attention", Number(unread) || 0),
  pickFolder: (): Promise<string | undefined> => ipcRenderer.invoke("panel:pick-folder"),
  memory: (): Promise<unknown> => ipcRenderer.invoke("desktop:memory"),
});
