import type { Part } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../../data/actions.ts";
import { useData } from "../../data/state.ts";
import { go } from "../../shell/nav.ts";
import { ShareMenu } from "../../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../../surfaces/SurfaceFrame.tsx";

/** A widget the agent produced, rendered inline with pin / app actions. */
export function SurfacePart({ part }: { part: Extract<Part, { type: "surface" }> }) {
  const surface = useData((s) => s.surfaces[part.surface_id]);
  if (!surface) {
    return (
      <div className="surfacecard surfacecard--gone">
        <Icons.LayoutGrid size={14} /> El widget “{part.title}” ya no existe.
      </div>
    );
  }
  return (
    <div className="surfacecard">
      <div className="surfacecard__head">
        <Icons.LayoutGrid size={12} />
        <span className="surfacecard__eyebrow">Widget · {surface.title}</span>
        <span className="surfacecard__spacer" />
        <IconButton
          size="sm"
          label={surface.pinned ? "Quitar del panel" : "Fijar al panel"}
          icon={surface.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
          active={surface.pinned}
          onClick={() => void setSurfaceFlags(surface.id, { pinned: !surface.pinned })}
        />
        <ShareMenu surface={surface} variant="icon" />
        <IconButton
          size="sm"
          label={surface.app ? "Abrir como app" : "Instalar como app"}
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
