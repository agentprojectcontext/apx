import { EmptyState, IconButton, Icons } from "@apx/ui";
import { useMemo } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/** The widgets made in the open chat, newest first; pinning one also puts it on its project's board. */
export function WidgetPanel() {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const surfaces = useData((s) => s.surfaces);
  const mine = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => threadId && s.thread_id === threadId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [surfaces, threadId],
  );
  if (!mine.length) {
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
      {mine.map((s) => (
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
              label={s.pinned ? t("widget.unpin") : t("widget.pin")}
              icon={s.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
              onClick={() => void setSurfaceFlags(s.id, { pinned: !s.pinned })}
            />
          </header>
          <SurfaceFrame surfaceId={s.id} />
        </section>
      ))}
    </div>
  );
}
