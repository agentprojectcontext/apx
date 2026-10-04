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
  // The local core's token when it asks for one (it listens beyond this computer); asked once, at load.
  coreToken: (ipcRenderer.sendSync("desktop:core-token") as string | undefined) || undefined,
});

type Answer = { ok: true } | { ok: false; reason?: string; error?: string };
// The first-run screen (connect.html): the main process only answers it when that page is what the window shows.
contextBridge.exposeInMainWorld("apxConnect", {
  local: (access: string): Promise<Answer> => ipcRenderer.invoke("connect:local", access),
  url: (url: string): Promise<Answer> => ipcRenderer.invoke("connect:url", url),
  ssh: (target: string): Promise<Answer> => ipcRenderer.invoke("connect:ssh", target),
});
