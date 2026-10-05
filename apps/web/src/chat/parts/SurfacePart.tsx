import type { Part } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { SurfaceActions } from "../../surfaces/SurfaceActions.tsx";
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
        <SurfaceActions surface={surface} />
      </div>
      <SurfaceFrame surfaceId={surface.id} />
    </div>
  );
}
