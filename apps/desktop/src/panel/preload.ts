// Sandboxed preload for APX's own pages (the panel and the quick chat): the few things the web UI asks of the shell.
import { contextBridge, ipcRenderer } from "electron";

type Bounds = { x: number; y: number; width: number; height: number };

contextBridge.exposeInMainWorld("apxDesktop", {
  /** darwin | win32 | linux — panel pads the unified title bar for traffic lights / overlay. */
  platform: process.platform,
  setBrowserBounds: (b: Bounds | null) => ipcRenderer.send("panel:browser-bounds", b),
  showBrowserTab: (tab: string) => ipcRenderer.send("panel:browser-tab", tab),
  /** The browser in a window of its own (true) or back in the side panel (false). */
  popOutBrowser: (open: boolean) => ipcRenderer.send("browser:popout", open === true),
  browserPoppedOut: (): boolean => ipcRenderer.sendSync("browser:popout-state") === true,
  onBrowserPopout: (listener: (open: boolean) => void) =>
    ipcRenderer.on("browser:popout", (_e, open: unknown) => listener(open === true)),
  installedBrowsers: (): Promise<unknown> => ipcRenderer.invoke("browser:installed"),
  /** `browser` undefined = the system's default browser. */
  openExternal: (url: string, browser?: string): Promise<unknown> =>
    ipcRenderer.invoke("browser:open-external", String(url), typeof browser === "string" ? browser : undefined),
  openMain: (threadId?: string) =>
    ipcRenderer.send("quick:open-main", typeof threadId === "string" ? threadId : undefined),
  onOpenThread: (listener: (threadId: string) => void) =>
    ipcRenderer.on("nav:thread", (_e, id: unknown) => {
      if (typeof id === "string") listener(id);
    }),
  applyDesktopPrefs: (prefs: { shortcut: string; launchAtLogin: boolean; computerUse?: boolean }) =>
    ipcRenderer.send("desktop:prefs", prefs),
  /** Computer use: what macOS allows APX, where the owner allows it, and the live view of what an agent works on. */
  computerPermissions: (): Promise<unknown> => ipcRenderer.invoke("computer:permissions"),
  openPrivacy: (kind: "screen" | "accessibility") => ipcRenderer.invoke("computer:open-privacy", kind),
  computerFrame: (): Promise<unknown> => ipcRenderer.invoke("computer:frame"),
  /** The emergency stop (also ⌘⇧Esc from any app): ends the turns using the computer, this time only. */
  stopComputer: () => ipcRenderer.invoke("computer:stop"),
  onComputerStopped: (listener: (stopped: boolean) => void) => {
    const on = (_e: unknown, stopped: unknown) => listener(stopped === true);
    ipcRenderer.on("computer:stopped", on);
    return () => ipcRenderer.removeListener("computer:stopped", on);
  },
  onComputerActivity: (listener: (a: unknown) => void) => {
    const on = (_e: unknown, a: unknown) => listener(a);
    ipcRenderer.on("computer:activity", on);
    return () => ipcRenderer.removeListener("computer:activity", on);
  },
  setAttention: (unread: number) => ipcRenderer.send("desktop:attention", Number(unread) || 0),
  setTitleBar: (mode: "light" | "dark") => ipcRenderer.send("desktop:titlebar", mode),
  setLanguage: (language: string) => ipcRenderer.send("desktop:language", String(language)),
  pickFolder: (): Promise<string | undefined> => ipcRenderer.invoke("panel:pick-folder"),
  memory: (): Promise<unknown> => ipcRenderer.invoke("desktop:memory"),
  /** Whether a newer APX app is out (check: ask the release feed now). */
  updateStatus: (check?: boolean): Promise<unknown> => ipcRenderer.invoke("desktop:update-status", check === true),
  /** Downloads the newer app and leaves it ready for the next restart (or opens it for the owner to drag in). */
  installUpdate: (): Promise<unknown> => ipcRenderer.invoke("desktop:update-install"),
  /** Quits and opens the newer app that is ready. */
  restartToUpdate: () => ipcRenderer.send("desktop:update-restart"),
  /** The app's update changed (found, downloading, ready), wherever it was started (the panel or the app menu). */
  onUpdateStatus: (listener: (status: unknown) => void) => {
    const on = (_e: unknown, s: unknown) => listener(s);
    ipcRenderer.on("desktop:update-changed", on);
    return () => ipcRenderer.removeListener("desktop:update-changed", on);
  },
  // The local core's token when it asks for one (it listens beyond this computer); asked once, at load.
  coreToken: (ipcRenderer.sendSync("desktop:core-token") as string | undefined) || undefined,
  // Whether the core runs on this computer (not one at an address or over SSH): Finder can show its files.
  coreLocal: ipcRenderer.sendSync("desktop:core-local") === true,
});

type Answer = { ok: true } | { ok: false; reason?: string; error?: string };
// The first-run screen (apx-app://app/?connect): the main process only answers it while the window shows that page.
contextBridge.exposeInMainWorld("apxConnect", {
  local: (access: string): Promise<Answer> => ipcRenderer.invoke("connect:local", access),
  url: (url: string): Promise<Answer> => ipcRenderer.invoke("connect:url", url),
  ssh: (target: string): Promise<Answer> => ipcRenderer.invoke("connect:ssh", target),
  installSsh: (target: string): Promise<Answer> => ipcRenderer.invoke("connect:ssh-install", target),
  // Which step the main process is on (ssh, probe, install, connect); returns a function that stops listening.
  onStep: (listener: (step: string) => void): (() => void) => {
    const on = (_e: unknown, step: string) => listener(step);
    ipcRenderer.on("connect:step", on);
    return () => ipcRenderer.off("connect:step", on);
  },
  // One line of the server install's output at a time; returns a function that stops listening.
  onProgress: (listener: (line: string) => void): (() => void) => {
    const on = (_e: unknown, line: string) => listener(line);
    ipcRenderer.on("connect:progress", on);
    return () => ipcRenderer.off("connect:progress", on);
  },
});
