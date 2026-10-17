import { EmptyState, Icons } from "@apx/ui";
import { useMemo } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/**
 * The widgets made in the open chat, newest first, or the one moved here from the chat; pinning one also puts it on its
 * project's board.
 */
export function WidgetPanel() {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const focused = useNav((s) => s.panelWidget);
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
  const one = focused ? mine.find((s) => s.id === focused) : undefined;
  return (
    <div className="widgets">
      {one && (
        <button type="button" className="widgets__back" onClick={() => go.widget()}>
          <Icons.ArrowLeft size={14} />
          {t("widgets.all", { n: mine.length })}
        </button>
      )}
      {(one ? [one] : mine).map((s) => (
        <section key={s.id} className="widgets__item" aria-label={s.title}>
          <header className="widgets__head">
            <span className="widgets__title">{s.title}</span>
            <SurfaceActions surface={s} />
          </header>
          <SurfaceFrame surfaceId={s.id} />
        </section>
      ))}
    </div>
  );
}
