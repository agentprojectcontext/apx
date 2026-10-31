import { Button, EmptyState, IconButton, Icons } from "@apx/ui";
import { useEffect, useMemo } from "react";
import { useSlice } from "../data/createStore.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import { WidgetEdit } from "../surfaces/WidgetEdit.tsx";
import { browserEdit, startEditing, stopEditing } from "./browserEdit.ts";

/**
 * The widgets made or shown in the open chat, newest first, or the one moved here from the chat; pinning one also puts
 * it on its project's board.
 */
export function WidgetPanel() {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const focused = useNav((s) => s.panelWidget);
  const surfaces = useData((s) => s.surfaces);
  const messages = useData((s) => (threadId ? s.messages[threadId] : undefined));
  const mine = useMemo(() => {
    // A widget keeps the chat that made it; another chat that shows it again only holds a card of it.
    const shown = new Set<string>();
    for (const m of messages ?? []) for (const p of m.parts) if (p.type === "surface") shown.add(p.surface_id);
    return Object.values(surfaces)
      .filter((s) => threadId && (s.thread_id === threadId || shown.has(s.id)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [surfaces, messages, threadId]);
  const editing = useSlice(browserEdit, (s) => s.target);
  const edited = editing?.startsWith("widget:") ? mine.find((s) => `widget:${s.id}` === editing) : undefined;
  // Another chat, or the widget gone: its edit mode ends with it.
  useEffect(() => {
    if (editing?.startsWith("widget:") && !edited) stopEditing();
  }, [editing, edited]);
  if (edited) {
    return (
      <div className="widgets widgets--edit">
        <header className="widgets__head">
          <span className="widgets__title">{edited.title}</span>
          <EditToggle id={edited.id} on />
        </header>
        <WidgetEdit surface={edited} />
      </div>
    );
  }
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
            <EditToggle id={s.id} on={false} />
            <SurfaceActions surface={s} />
          </header>
          <SurfaceFrame surfaceId={s.id} />
        </section>
      ))}
    </div>
  );
}

/** Edit mode for one widget: point at its parts and ask the agent for changes, as in a browser tab. */
function EditToggle({ id, on }: { id: string; on: boolean }) {
  const t = useT();
  return on ? (
    <Button
      size="sm"
      variant="primary"
      aria-pressed
      leadingIcon={<Icons.Pencil size={13} />}
      onClick={() => stopEditing()}
    >
      {t("browser.edit")}
    </Button>
  ) : (
    <IconButton
      size="sm"
      label={t("browser.editHint")}
      icon={<Icons.Pencil size={14} />}
      onClick={() => startEditing(`widget:${id}`)}
    />
  );
}
