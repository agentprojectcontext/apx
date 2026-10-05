import type { SurfaceSummary } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ShareMenu } from "./ShareMenu.tsx";

/**
 * A widget's actions wherever its header shows (chat card, widget panel, board tile): on the board and in Apps light
 * up while it is there, so it reads the same in every place.
 */
export function SurfaceActions({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  return (
    <>
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
    </>
  );
}
