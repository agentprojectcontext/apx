import type { DesktopInstaller } from "../../../../packages/install/src/desktop.ts";
import type { Handlers } from "./router.ts";

export function desktopInstallHandlers(installer: DesktopInstaller) {
  return {
    "desktop.install_status": () => installer.status(),
    "desktop.install": () => installer.start(),
  } satisfies Partial<Handlers>;
}
