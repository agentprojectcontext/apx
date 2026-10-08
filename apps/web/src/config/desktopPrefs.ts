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
