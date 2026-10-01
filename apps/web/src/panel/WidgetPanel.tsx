import { EmptyState, IconButton, Icons } from "@apx/ui";
import { useMemo } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/** Pinned surfaces stacked, newest first. */
export function WidgetPanel() {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const pinned = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => s.pinned)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [surfaces],
  );
  if (!pinned.length) {
    return (
      <div className="sidepanel__body">
        <EmptyState icon={<Icons.LayoutGrid />} title={t("widgets.empty")}>
          {t("widgets.emptyBody")}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="widgets">
      {pinned.map((s) => (
        <section key={s.id} className="widgets__item" aria-label={s.title}>
          <header className="widgets__head">
            <span className="widgets__title">{s.title}</span>
            <ShareMenu surface={s} variant="icon" />
            {s.app && (
              <IconButton
                size="sm"
                label={t("widget.openApp")}
                icon={<Icons.AppWindow size={14} />}
                onClick={() => go.app(s.id)}
              />
            )}
            <IconButton
              size="sm"
              label={t("widget.unpin")}
              icon={<Icons.PinOff size={14} />}
              onClick={() => void setSurfaceFlags(s.id, { pinned: false })}
            />
          </header>
          <SurfaceFrame surfaceId={s.id} />
        </section>
      ))}
    </div>
  );
}
