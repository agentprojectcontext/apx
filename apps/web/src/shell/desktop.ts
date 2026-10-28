import { useSyncExternalStore } from "react";

// The window says when it is in native fullscreen; older desktop builds don't, so their size is the guess: a
// full-screen window covers the whole display, a zoomed one still leaves the menu bar (macOS) or taskbar out.
function fullscreen(): boolean {
  const told = window.apxDesktop?.isFullScreen;
  if (told) return told();
  return window.outerWidth >= window.screen.width && window.outerHeight >= window.screen.height;
}

function onResize(listener: () => void): () => void {
  const off = window.apxDesktop?.onFullScreen?.(listener);
  window.addEventListener("resize", listener);
  return () => {
    off?.();
    window.removeEventListener("resize", listener);
  };
}

/**
 * Classes for a bar that shares the window with the native controls: ` is-desktop is-mac` (traffic lights on the
 * left), ` is-win`/` is-linux` (the overlay on the right), plus ` is-fullscreen` when macOS hides the traffic lights.
 */
export function useDesktopClass(): string {
  const full = useSyncExternalStore(onResize, fullscreen, () => false);
  if (typeof window === "undefined" || !window.apxDesktop) return "";
  const platform = window.apxDesktop.platform;
  const os =
    platform === "darwin" ? " is-mac" : platform === "win32" ? " is-win" : platform === "linux" ? " is-linux" : "";
  return ` is-desktop${os}${full ? " is-fullscreen" : ""}`;
}
