import { client } from "../data/client.ts";

/** Applies the desktop settings in the shell (no-op in a plain browser). Kept apart so the shell loads without Config. */
export async function applyDesktopPrefs(): Promise<void> {
  if (!window.apxDesktop?.applyDesktopPrefs) return;
  try {
    const p = await client.call("desktop.get", {});
    window.apxDesktop.applyDesktopPrefs({
      shortcut: p.shortcut,
      launchAtLogin: p.launch_at_login,
      computerUse: p.computer_use,
    });
  } catch {}
}

/** Computer use runs in the desktop app on macOS and Windows. */
export const computerUseHere = () => ["darwin", "win32"].includes(window.apxDesktop?.platform ?? "");

/** The emergency stop's keys on this computer (Ctrl+Shift+Esc is Windows' Task Manager). */
export const stopKeys = () => (window.apxDesktop?.platform === "win32" ? "Ctrl+Alt+Esc" : "⌘⇧Esc");
