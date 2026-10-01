import { BrowserTabs, EmptyState, IconButton, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserClose, loadTabs } from "../data/actions.ts";
import { nav } from "../shell/nav.ts";
import { BrowserToolbar, HandoffBar } from "./BrowserToolbar.tsx";
import { BrowserViewport } from "./BrowserViewport.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import { useActiveTab } from "./useActiveTab.ts";

/** Browser panel: tab strip in the header, toolbar (back · reload · address · who drives), then the page. */
export function BrowserPanel() {
  const { tabs, active } = useActiveTab();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadTabs();
  }, []);

  return (
    <>
      <PanelHeader
        actions={
          active && (
            <IconButton
              label="Abrir en ventana"
              icon={<Icons.ExternalLink size={15} />}
              onClick={() => window.open(active.url, "_blank", "noopener,noreferrer")}
            />
          )
        }
      >
        <BrowserTabs
          value={adding ? undefined : active?.tab}
          onValueChange={(id) => {
            setAdding(false);
            nav.set({ browserTab: id });
          }}
          onClose={(id) => void browserClose(id)}
          onNew={() => setAdding(true)}
          tabs={tabs.map((t) => ({ id: t.tab, title: t.title || hostPath(t.url), url: t.url, holder: t.control.kind }))}
        />
      </PanelHeader>
      {active || adding ? (
        <div className="browser">
          <BrowserToolbar tab={adding ? undefined : active} onOpened={() => setAdding(false)} />
          {!adding && active?.control.kind === "handoff" && <HandoffBar tab={active} />}
          {adding || !active ? (
            <EmptyState icon={<Icons.Globe />} title="Nueva pestaña">
              Escribí una dirección arriba y apretá Enter.
            </EmptyState>
          ) : (
            <BrowserViewport tab={active.tab} />
          )}
        </div>
      ) : (
        <div className="sidepanel__body">
          <EmptyState icon={<Icons.Globe />} title="No hay pestañas abiertas">
            Cuando un agente navegue, lo ves acá en vivo y podés tomar el control.
          </EmptyState>
        </div>
      )}
    </>
  );
}
