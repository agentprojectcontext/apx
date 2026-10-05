// Sandboxed preload for APX's own pages (the panel and the quick chat): the few things the web UI asks of the shell.
import { contextBridge, ipcRenderer } from "electron";

type Bounds = { x: number; y: number; width: number; height: number };

contextBridge.exposeInMainWorld("apxDesktop", {
  /** darwin | win32 | linux — panel pads the unified title bar for traffic lights / overlay. */
  platform: process.platform,
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
  setTitleBar: (mode: "light" | "dark") => ipcRenderer.send("desktop:titlebar", mode),
  pickFolder: (): Promise<string | undefined> => ipcRenderer.invoke("panel:pick-folder"),
  memory: (): Promise<unknown> => ipcRenderer.invoke("desktop:memory"),
  /** Whether a newer APX app is out (check: ask the release feed now). */
  updateStatus: (check?: boolean): Promise<unknown> => ipcRenderer.invoke("desktop:update-status", check === true),
  /** Downloads the newer app and puts it in place (it restarts by itself, or opens for the owner on macOS). */
  installUpdate: (): Promise<unknown> => ipcRenderer.invoke("desktop:update-install"),
  // The local core's token when it asks for one (it listens beyond this computer); asked once, at load.
  coreToken: (ipcRenderer.sendSync("desktop:core-token") as string | undefined) || undefined,
});

type Answer = { ok: true } | { ok: false; reason?: string; error?: string };
// The first-run screen (apx-app://app/?connect): the main process only answers it while the window shows that page.
contextBridge.exposeInMainWorld("apxConnect", {
  local: (access: string): Promise<Answer> => ipcRenderer.invoke("connect:local", access),
  url: (url: string): Promise<Answer> => ipcRenderer.invoke("connect:url", url),
  ssh: (target: string): Promise<Answer> => ipcRenderer.invoke("connect:ssh", target),
});
