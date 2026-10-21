import type { SurfaceSummary } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ArtifactMemoryButton } from "./ArtifactMemory.tsx";
import { linkOf, ShareMenu } from "./ShareMenu.tsx";
import { openWidgetChat } from "./WidgetChat.tsx";

/**
 * A widget's actions wherever its header shows (chat card, widget panel, board tile): its chat with the agent that
 * keeps it, and on the board and in Apps, lit while it is there, so it reads the same in every place.
 */
export function SurfaceActions({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  return (
    <>
      <IconButton
        size="sm"
        label={t("widget.chat")}
        icon={<Icons.MessageSquare size={14} />}
        onClick={() => void openWidgetChat(surface)}
      />
      <IconButton
        size="sm"
        label={surface.pinned ? t("widget.unpin") : t("widget.pin")}
        icon={surface.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
        active={surface.pinned}
        onClick={() => void setSurfaceFlags(surface.id, { pinned: !surface.pinned })}
      />
      <IconButton
        size="sm"
        label={surface.app ? t("widget.openApp") : t("widget.installApp")}
        icon={<Icons.AppWindow size={14} />}
        active={surface.app}
        onClick={() => {
          if (surface.app) go.app(surface.id);
          else void setSurfaceFlags(surface.id, { app: true });
        }}
      />
      <ShareMenu surface={surface} variant="icon" />
      <ArtifactMemoryButton surface={surface} />
      <OpenInBrowser surface={surface} />
    </>
  );
}

/** A shared widget opens at its public link; a private one at this panel's own address, reachable only where it is. */
function OpenInBrowser({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  const shared = linkOf(surface);
  const url = shared ?? `${window.location.origin}/#app=${encodeURIComponent(surface.id)}`;
  return (
    <IconButton
      size="sm"
      label={shared ? t("widget.openBrowser") : t("widget.openBrowserLocal")}
      icon={<Icons.ExternalLink size={14} />}
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
    />
  );
}
