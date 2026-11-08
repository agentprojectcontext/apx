import { Icons, NavItem } from "@apx/ui";
import { useSetup } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import { busy, installDesktop, localBrowser, useDesktopInstall, useDesktopInstallWatch } from "./desktopInstall.ts";
import "../styles/desktop-install.css";

/**
 * The sidebar's way to the desktop app, in a browser on this computer, once it is installed or its notice was put off.
 * The notice itself comes with the others (the corner cards or the strip over the page); this keeps its state fresh.
 */
export function DesktopInstallNotice({ rail = false }: { rail?: boolean }) {
  const t = useT();
  useDesktopInstallWatch();
  const setup = useSetup((s) => s.open);
  const status = useDesktopInstall((s) => s.status);
  const dismissed = useDesktopInstall((s) => s.dismissed);
  const starting = useDesktopInstall((s) => s.starting);
  if (!localBrowser() || setup || !status?.available || !(status.installed || dismissed)) return null;
  const working = starting || busy(status);
  return (
    <div className="desktop-launch">
      <NavItem
        collapsed={rail}
        icon={<Icons.Monitor />}
        label={t(
          working ? "desktopInstall.opening" : status.installed ? "desktopInstall.open" : "desktopInstall.install",
        )}
        disabled={working}
        onClick={() => void installDesktop()}
      />
    </div>
  );
}
