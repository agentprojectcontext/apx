import type { Part } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../../data/actions.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { ShareMenu } from "../../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../../surfaces/SurfaceFrame.tsx";

/** A widget the agent produced, rendered inline with pin / app actions. */
export function SurfacePart({ part }: { part: Extract<Part, { type: "surface" }> }) {
  const t = useT();
  const surface = useData((s) => s.surfaces[part.surface_id]);
  if (!surface) {
    return (
      <div className="surfacecard surfacecard--gone">
        <Icons.LayoutGrid size={14} /> {t("widget.gone", { title: part.title })}
      </div>
    );
  }
  return (
    <div className="surfacecard">
      <div className="surfacecard__head">
        <Icons.LayoutGrid size={12} />
        <span className="surfacecard__eyebrow">{t("widget.eyebrow", { title: surface.title })}</span>
        {surface.connect && (
          <span className="surfacecard__net" title={surface.connect.join("\n")}>
            <Icons.Globe size={12} />
            {t("widget.connects", { hosts: surface.connect.map((o) => new URL(o).hostname).join(", ") })}
          </span>
        )}
        <span className="surfacecard__spacer" />
        <IconButton
          size="sm"
          label={surface.pinned ? t("widget.unpin") : t("widget.pin")}
          icon={surface.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
          active={surface.pinned}
          onClick={() => void setSurfaceFlags(surface.id, { pinned: !surface.pinned })}
        />
        <ShareMenu surface={surface} variant="icon" />
        <IconButton
          size="sm"
          label={surface.app ? t("widget.openApp") : t("widget.installApp")}
          icon={<Icons.AppWindow size={14} />}
          onClick={() => {
            if (surface.app) go.app(surface.id);
            else void setSurfaceFlags(surface.id, { app: true });
          }}
        />
      </div>
      <SurfaceFrame surfaceId={surface.id} />
    </div>
  );
}
