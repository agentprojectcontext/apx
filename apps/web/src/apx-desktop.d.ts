// Bridge the desktop app (Electron preload) exposes to the panel. Absent in a plain browser.
export {};

declare global {
  interface Window {
    apxDesktop?: {
      /** Where to place the real browser view, in viewport CSS pixels (integers); null hides it. */
      setBrowserBounds(bounds: { x: number; y: number; width: number; height: number } | null): void;
      /** Which tab the native browser view shows. */
      showBrowserTab?(tab: string): void;
    };
  }
}
