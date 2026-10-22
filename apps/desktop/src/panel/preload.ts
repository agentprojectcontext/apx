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
  onBrowserPopout: (listener: (open: boolean) => void) => {
    const on = (_e: unknown, open: unknown) => listener(open === true);
    ipcRenderer.on("browser:popout", on);
    return () => ipcRenderer.removeListener("browser:popout", on);
  },
  installedBrowsers: (): Promise<unknown> => ipcRenderer.invoke("browser:installed"),
  /** `browser` undefined = the system's default browser. */
  openExternal: (url: string, browser?: string): Promise<unknown> =>
    ipcRenderer.invoke("browser:open-external", String(url), typeof browser === "string" ? browser : undefined),
  /** An artifact in a window of its own. */
  openArtifactWindow: (id: string, title: string) =>
    ipcRenderer.send("artifact:open-window", String(id), String(title)),
  closeArtifactWindow: (id: string) => ipcRenderer.send("artifact:close-window", String(id)),
  onArtifactWindow: (listener: (id: string, open: boolean) => void) => {
    const on = (_e: unknown, id: unknown, open: unknown) => {
      if (typeof id === "string") listener(id, open === true);
    };
    ipcRenderer.on("artifact:window", on);
    return () => ipcRenderer.removeListener("artifact:window", on);
  },
  openMain: (threadId?: string) =>
    ipcRenderer.send("quick:open-main", typeof threadId === "string" ? threadId : undefined),
  /** Files the owner opened with APX, each with its text or why it has none; taken once. */
  takeOpenedFiles: (): Promise<unknown> => ipcRenderer.invoke("artifact:take-opened"),
  onFileOpened: (listener: () => void) => {
    const on = () => listener();
    ipcRenderer.on("artifact:file-opened", on);
    return () => ipcRenderer.removeListener("artifact:file-opened", on);
  },
  onOpenThread: (listener: (threadId: string) => void) => {
    const on = (_e: unknown, id: unknown) => {
      if (typeof id === "string") listener(id);
    };
    ipcRenderer.on("nav:thread", on);
    return () => ipcRenderer.removeListener("nav:thread", on);
  },
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
  /** Runs an app menu item (about, update, change-connection): Windows and Linux have no menu bar to show it. */
  menuAction: (id: string) => ipcRenderer.send("desktop:menu-action", String(id)),
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

// ready: installed on a server and reachable, but not opened yet (the screen says so first); linger names the user
// whose services stop at logout until they linger. key: this app's public key, for the owner to add by hand.
type Answer =
  | { ok: true; ready?: true; linger?: string }
  | { ok: false; reason?: string; error?: string; key?: string };
type SshPrompt = { id: string; text: string; secret: boolean };
// The first-run screen (apx-app://app/?connect): the main process only answers it while the window shows that page.
contextBridge.exposeInMainWorld("apxConnect", {
  local: (access: string): Promise<Answer> => ipcRenderer.invoke("connect:local", access),
  url: (url: string): Promise<Answer> => ipcRenderer.invoke("connect:url", url),
  ssh: (target: string): Promise<Answer> => ipcRenderer.invoke("connect:ssh", target),
  installSsh: (target: string): Promise<Answer> => ipcRenderer.invoke("connect:ssh-install", target),
  lingerSsh: (target: string, password: string): Promise<Answer> =>
    ipcRenderer.invoke("connect:ssh-linger", target, password),
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
  // ssh asks something (password, passphrase, host key); null = no question is waiting any more.
  onPrompt: (listener: (prompt: SshPrompt | null) => void): (() => void) => {
    const on = (_e: unknown, prompt: SshPrompt | null) => listener(prompt);
    ipcRenderer.on("connect:prompt", on);
    return () => ipcRenderer.off("connect:prompt", on);
  },
  // The owner's answer to that question; undefined cancels it.
  answer: (id: string, answer: string | undefined) =>
    ipcRenderer.send("connect:answer", String(id), typeof answer === "string" ? answer : undefined),
});
