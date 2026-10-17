import type { Part } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go, useNav } from "../../shell/nav.ts";
import { SurfaceActions } from "../../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../../surfaces/SurfaceFrame.tsx";

/** A widget the agent produced, rendered inline with pin / app actions; a card while it shows in the side panel. */
export function SurfacePart({ part }: { part: Extract<Part, { type: "surface" }> }) {
  const t = useT();
  const surface = useData((s) => s.surfaces[part.surface_id]);
  const aside = useNav((s) => s.panel === "widget" && s.panelWidget === part.surface_id);
  if (!surface) {
    return (
      <div className="surfacecard surfacecard--gone">
        <Icons.LayoutGrid size={14} /> {t("widget.gone", { title: part.title })}
      </div>
    );
  }
  if (aside)
    return (
      <div className="surfacecard surfacecard--aside">
        <Icons.LayoutGrid size={16} />
        <span className="surfacecard__asidetext">
          <span className="surfacecard__asidetitle">{surface.title}</span>
          <span className="surfacecard__asidenote">{t("widget.inPanel")}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => go.panel(null)}>
          {t("widget.showHere")}
        </Button>
      </div>
    );
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
        <SurfaceActions surface={surface} />
        <IconButton
          size="sm"
          label={t("widget.toPanel")}
          icon={<Icons.PanelRightOpen size={14} />}
          onClick={() => go.widget(surface.id)}
        />
      </div>
      <SurfaceFrame surfaceId={surface.id} />
    </div>
  );
}
