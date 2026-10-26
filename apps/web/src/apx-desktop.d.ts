// Bridge the desktop app (Electron preload) exposes to the panel. Absent in a plain browser.
type ConnectAnswer =
  | { ok: true; ready?: true; linger?: string }
  | { ok: false; reason?: string; error?: string; key?: string };

/** A question ssh asks while logging in: masked (`secret`) for a password or passphrase, plain for yes/no. */
export type SshPrompt = { id: string; text: string; secret: boolean };

/** The desktop app's own update (it carries its own core). */
export type DesktopUpdate = {
  current: string;
  latest?: string;
  notes: string[];
  /** auto: it downloads and goes in at the next restart; drag: macOS opens the disk image for the owner. */
  install: "auto" | "drag" | "none";
  /** Downloading the newer app now. */
  downloading?: boolean;
  /** The newer app, downloaded and checked: it goes in when APX restarts. */
  ready?: string;
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
      /** Installs APX on that server over SSH (this app's version), then connects to it. */
      installSsh(target: string): Promise<ConnectAnswer>;
      /** Turns on linger for the SSH user with sudo; the password goes to sudo over ssh and is not kept. */
      lingerSsh(target: string, password: string): Promise<ConnectAnswer>;
      onProgress(listener: (line: string) => void): () => void;
      /** Missing in builds from before the steps were reported. */
      onStep?(listener: (step: string) => void): () => void;
      /** ssh asks something while logging in with a password; null = nothing waits any more. */
      onPrompt?(listener: (prompt: SshPrompt | null) => void): () => void;
      /** The owner's answer to that question, never kept; undefined cancels it. */
      answer?(id: string, answer: string | undefined): void;
    };
    apxDesktop?: {
      /** Host OS of the desktop shell (`darwin` | `win32` | `linux`). */
      platform?: string;
      /** The core's token, when the app knows it: the panel sends it on every call. */
      coreToken?: string;
      updateAuth?(token?: string): void;
      /** Whether the core runs on this computer; false for one at an address or over SSH. */
      coreLocal?: boolean;
      /** Where to place the real browser view, in viewport CSS pixels (integers); null hides it. */
      setBrowserBounds(bounds: { x: number; y: number; width: number; height: number } | null): void;
      /** Which tab the native browser view shows. */
      showBrowserTab?(tab: string): void;
      /** Moves the browser to a window of its own (true) or back into the side panel (false). */
      popOutBrowser?(open: boolean): void;
      /** Whether the browser is in its own window right now. */
      browserPoppedOut?(): boolean;
      /** The main window hears when the browser window opens or closes. */
      onBrowserPopout?(listener: (open: boolean) => void): () => void;
      /** The browsers installed on this computer (Chrome, Safari, Firefox…). */
      installedBrowsers?(): Promise<Array<{ id: string; name: string }>>;
      /** Opens a web page in the system's default browser, or in an installed one by id. */
      openExternal?(url: string, browser?: string): Promise<boolean>;
      /** Opens an artifact in a desktop window of its own (one per artifact). */
      openArtifactWindow?(id: string, title: string): void;
      /** Closes an artifact's own window; the panel shows the app again. */
      closeArtifactWindow?(id: string): void;
      /** An artifact's window opened or closed (by any means). */
      onArtifactWindow?(listener: (id: string, open: boolean) => void): () => void;
      /** From the quick window: bring the main window up, on this chat. */
      openMain?(threadId?: string): void;
      /** The main window is told to open a chat (asked from the quick window). */
      /** Files opened with APX from the system, each with its text or why it has none (taken once). */
      takeOpenedFiles?(): Promise<{ name: string; text?: string; error?: "too-big" | "unreadable" }[]>;
      onFileOpened?(listener: () => void): () => void;
      onOpenThread?(listener: (threadId: string) => void): () => void;
      /** Runs one of the app menu's items: Windows and Linux show no menu bar for them. */
      menuAction?(id: "about" | "update" | "change-connection"): void;
      /** Applies the desktop settings (shortcut, start at login, computer use) in the shell. */
      applyDesktopPrefs?(prefs: { shortcut: string; launchAtLogin: boolean; computerUse?: boolean }): void;
      /** What macOS lets APX do for computer use: see the screen ("granted"…) and drive other apps. */
      computerPermissions?(): Promise<{ screen: string; accessibility: boolean } | undefined>;
      /** Opens the System Settings pane where the owner allows it. */
      openPrivacy?(kind: "screen" | "accessibility"): Promise<void>;
      /** A live frame of the window an agent works on (a data URL), or nothing yet. */
      computerFrame?(): Promise<unknown>;
      /** The emergency stop (also its keys from any app): ends the turns using the computer, this time only. */
      stopComputer?(): Promise<void>;
      onComputerStopped?(listener: (stopped: boolean) => void): () => void;
      /** An agent looked at the screen, clicked or typed; returns how to stop listening. */
      onComputerActivity?(listener: (a: unknown) => void): () => void;
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
      /** Downloads the newer app and leaves it ready (`ready: false`: opened for the owner to drag in). */
      installUpdate?(): Promise<{ ok: true; ready: boolean } | { ok: false; error: string } | undefined>;
      /** Quits and opens the newer app that is ready. */
      restartToUpdate?(): void;
      /** The app's update changed, wherever it was started (the panel or the app menu). */
      onUpdateStatus?(listener: (status: DesktopUpdate) => void): () => void;
      /** What each of the app's processes takes in memory (the panel, each browser tab, the GPU…), biggest first. */
      memory?(): Promise<
        | {
            total_mb: number;
            items: Array<{
              pid: number;
              kind: "main" | "gpu" | "panel" | "quick" | "tab" | "page" | "app" | "helper";
              site?: string;
              mb: number;
            }>;
          }
        | undefined
      >;
    };
  }
}
