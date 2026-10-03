// Bridge the desktop app (Electron preload) exposes to the panel. Absent in a plain browser.
export {};

declare global {
  interface Window {
    apxDesktop?: {
      /** Where to place the real browser view, in viewport CSS pixels (integers); null hides it. */
      setBrowserBounds(bounds: { x: number; y: number; width: number; height: number } | null): void;
      /** Which tab the native browser view shows. */
      showBrowserTab?(tab: string): void;
      /** From the quick window: bring the main window up, on this chat. */
      openMain?(threadId?: string): void;
      /** The main window is told to open a chat (asked from the quick window). */
      onOpenThread?(listener: (threadId: string) => void): void;
      /** Applies the desktop settings (shortcut, start at login) in the shell. */
      applyDesktopPrefs?(prefs: { shortcut: string; launchAtLogin: boolean }): void;
      /** How many notices wait for the owner: shown on the menu-bar icon and the Dock. */
      setAttention?(unread: number): void;
      /** The system's folder dialog; undefined when the owner cancels. */
      pickFolder?(): Promise<string | undefined>;
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
