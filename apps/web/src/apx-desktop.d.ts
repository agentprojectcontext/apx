// Bridge the desktop app (Electron preload) exposes to the panel. Absent in a plain browser.
type ConnectAnswer = { ok: true } | { ok: false; reason?: string; error?: string };

/** The desktop app's own update (it carries its own core). */
export type DesktopUpdate = {
  current: string;
  latest?: string;
  notes: string[];
  /** auto: it puts itself in place and restarts; drag: macOS opens the disk image for the owner. */
  install: "auto" | "drag" | "none";
  checked_at?: string;
  error?: string;
};

declare global {
  interface Window {
    /** Only on the desktop app's first-run page: this computer's APX (server) or one elsewhere (client). */
    apxConnect?: {
      local(access: "none" | "lan" | "tailscale"): Promise<ConnectAnswer>;
      url(url: string): Promise<ConnectAnswer>;
      ssh(target: string): Promise<ConnectAnswer>;
    };
    apxDesktop?: {
      /** Host OS of the desktop shell (`darwin` | `win32` | `linux`). */
      platform?: string;
      /** The core's token, when the app knows it: the panel sends it on every call. */
      coreToken?: string;
      /** Where to place the real browser view, in viewport CSS pixels (integers); null hides it. */
      setBrowserBounds(bounds: { x: number; y: number; width: number; height: number } | null): void;
      /** Which tab the native browser view shows. */
      showBrowserTab?(tab: string): void;
      /** Moves the browser to a window of its own (true) or back into the side panel (false). */
      popOutBrowser?(open: boolean): void;
      /** Whether the browser is in its own window right now. */
      browserPoppedOut?(): boolean;
      /** The main window hears when the browser window opens or closes. */
      onBrowserPopout?(listener: (open: boolean) => void): void;
      /** The browsers installed on this computer (Chrome, Safari, Firefox…). */
      installedBrowsers?(): Promise<Array<{ id: string; name: string }>>;
      /** Opens a web page in the system's default browser, or in an installed one by id. */
      openExternal?(url: string, browser?: string): Promise<boolean>;
      /** From the quick window: bring the main window up, on this chat. */
      openMain?(threadId?: string): void;
      /** The main window is told to open a chat (asked from the quick window). */
      onOpenThread?(listener: (threadId: string) => void): void;
      /** Applies the desktop settings (shortcut, start at login) in the shell. */
      applyDesktopPrefs?(prefs: { shortcut: string; launchAtLogin: boolean }): void;
      /** How many notices wait for the owner: shown on the menu-bar icon and the Dock. */
      setAttention?(unread: number): void;
      /** The panel's language, for the shell's own windows (About), which cannot read the panel's settings. */
      setLanguage?(language: string): void;
      /** Windows/Linux: match the native title-bar overlay to the panel theme. */
      setTitleBar?(mode: "light" | "dark"): void;
      /** The system's folder dialog; undefined when the owner cancels. */
      pickFolder?(): Promise<string | undefined>;
      /** Whether a newer APX app is out; `check` asks the release feed now. */
      updateStatus?(check?: boolean): Promise<DesktopUpdate | undefined>;
      /** Downloads the newer app and puts it in place. */
      installUpdate?(): Promise<{ ok: true; restarting: boolean } | { ok: false; error: string } | undefined>;
      /** What each of the app's processes takes in memory (the panel, each browser tab, the GPU…), biggest first. */
      memory?(): Promise<
        | {
            total_mb: number;
            items: Array<{
              pid: number;
              kind: "main" | "gpu" | "panel" | "quick" | "tab" | "page" | "helper";
              site?: string;
              mb: number;
            }>;
          }
        | undefined
      >;
    };
  }
}
