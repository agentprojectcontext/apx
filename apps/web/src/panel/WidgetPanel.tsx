import { Button, EmptyState, IconButton, Icons } from "@apx/ui";
import { Fragment, useEffect, useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { useSlice } from "../data/createStore.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { openPage } from "../surfaces/pageActions.tsx";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import { WidgetEdit } from "../surfaces/WidgetEdit.tsx";
import { browserEdit, startEditing, stopEditing } from "./browserEdit.ts";
import { closeTab, useOpenTabs } from "./openTabs.ts";
import { LIST_TAB, PanelGroup, PanelList, PanelRow, PanelTabs } from "./PanelTabs.tsx";

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
  const edited = editing?.startsWith("widget:") ? mine.find((s) => !s.page && `widget:${s.id}` === editing) : undefined;
  // Another chat, or the widget gone: its edit mode ends with it. A web page's is on its own screen.
  const editsPage = editing?.startsWith("widget:") && surfaces[editing.slice("widget:".length)]?.page;
  useEffect(() => {
    if (editing?.startsWith("widget:") && !edited && !editsPage) stopEditing();
  }, [editing, edited, editsPage]);
  const key = threadId && `widget:${threadId}`;
  const open = useOpenTabs(key, focused);
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
  const one = focused ? mine.find((s) => s.id === focused) : undefined;
  const tabs = open.flatMap((id) => {
    const s = mine.find((x) => x.id === id);
    return s ? [{ id, label: s.title }] : [];
  });
  const groups = [
    { title: "panelTabs.pages", items: mine.filter((s) => s.page), icon: <Icons.Globe size={16} /> },
    { title: "panelTabs.apps", items: mine.filter((s) => !s.page && s.app), icon: <Icons.AppWindow size={16} /> },
    { title: "panelTabs.widgets", items: mine.filter((s) => !s.page && !s.app), icon: <Icons.LayoutGrid size={16} /> },
  ] as const;
  return (
    <>
      <PanelTabs
        label={t("panel.widget")}
        list={t("panelTabs.all", { n: mine.length })}
        tabs={tabs}
        value={one ? one.id : LIST_TAB}
        onSelect={(id) => go.widget(id === LIST_TAB ? undefined : id)}
        onClose={(id) => {
          if (key) closeTab(key, id);
          if (id === focused) go.widget();
        }}
      />
      {one ? (
        <div className="widgets">
          <section className="widgets__item" aria-label={one.title}>
            <header className="widgets__head">
              <span className="widgets__title">{one.title}</span>
              <EditToggle id={one.id} on={false} page={one.page} />
              <SurfaceActions surface={one} inChat />
            </header>
            <SurfaceFrame surfaceId={one.id} />
          </section>
        </div>
      ) : !mine.length ? (
        <div className="sidepanel__body">
          <EmptyState icon={<Icons.LayoutGrid />} title={t("widgets.empty")}>
            {t("widgets.emptyBody")}
          </EmptyState>
        </div>
      ) : (
        <PanelList label={t("panel.widget")}>
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <Fragment key={g.title}>
                  <PanelGroup title={t(g.title, { n: g.items.length })} />
                  {g.items.map((s) => (
                    <PanelRow
                      key={s.id}
                      leading={g.icon}
                      title={s.title}
                      trailing={shortWhen(s.updated_at)}
                      onClick={() => go.widget(s.id)}
                    />
                  ))}
                </Fragment>
              ),
          )}
        </PanelList>
      )}
    </>
  );
}

/** Edit mode for one widget: point at its parts and ask the agent for changes, as in a browser tab. */
function EditToggle({ id, on, page = false }: { id: string; on: boolean; page?: boolean | undefined }) {
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
      // A web page is edited on its own screen, at its real width.
      onClick={() => (page ? openPage(id, true) : startEditing(`widget:${id}`))}
    />
  );
}
