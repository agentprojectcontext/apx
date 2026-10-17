import type { EngineStatus } from "@apx/protocol";
import { EngineIcon, engineBrand, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { rememberSidebar, setPrefs, usePrefs, useSidebarRows } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";
import { orderItems, SidebarNavRow } from "./SidebarNavRow.tsx";
import { SidebarOverflow, SidebarRowsGrip, SidebarSection } from "./SidebarSection.tsx";

/**
 * Last opened engine first, with the same row actions and manual ordering as the other sections; past the rows the
 * owner dragged it to, the rest folds into "N more" like Projects.
 */
export function ExternalSessionsNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.externalSessionsFolded);
  const saved = usePrefs((s) => s.engineOrder);
  const engines = useData((s) => s.engines);
  const view = useNav((s) => s.view);
  const engineId = useNav((s) => s.engineId);
  const rows = useSidebarRows("engines");
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (view === "engine" && engineId) rememberSidebar("engineOrder", engineId);
  }, [view, engineId]);
  const rank = new Map(saved.map((id, index) => [id, index]));
  const shown = engines
    .filter((engine) => engine.id !== "native" && engine.installed)
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const order = shown.map((engine) => engine.id);
  // Folding a single leftover would save nothing.
  const cut = shown.length > rows + 1 ? rows : shown.length;
  const rest = shown.slice(cut);
  const hidden = folded && !rail;
  const move = (id: string, index: number) => {
    if (!order.includes(id)) return;
    const ids = order.filter((current) => current !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    setPrefs({ engineOrder: ids });
  };
  const open = (id: string) => {
    setMoreOpen(false);
    go.engine(id);
  };
  const row = (engine: EngineStatus, overflow = false) => (
    <SidebarNavRow
      key={engine.id}
      id={engine.id}
      kind="engine"
      label={engine.label}
      rail={rail && !overflow}
      icon={<SessionIcon engine={engine.id} />}
      trailing={<EngineState engine={engine} />}
      active={view === "engine" && engineId === engine.id}
      onPick={() => open(engine.id)}
      order={order}
      onMove={move}
      items={[
        { label: t("nav.open"), icon: <Icons.Terminal />, onSelect: () => open(engine.id) },
        { label: t("nav.engineSettings"), icon: <Icons.Settings />, onSelect: () => go.config("external") },
        { type: "separator" },
        ...orderItems(t, engine.id, order, move),
      ]}
    />
  );
  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.externalSessions")}
        folded={folded}
        onToggle={() => {
          setMoreOpen(false);
          setPrefs({ externalSessionsFolded: !folded });
        }}
      />
      {!hidden && shown.slice(0, cut).map((engine) => row(engine))}
      {!hidden && rest.length > 0 && (
        <SidebarOverflow
          rail={rail}
          title={t("nav.externalSessions")}
          text={t("nav.moreProjects", { n: rest.length })}
          label={t("nav.moreSessions", { n: rest.length })}
          count={rest.length}
          active={view === "engine" && rest.some((engine) => engine.id === engineId)}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          {rest.map((engine) => row(engine, true))}
        </SidebarOverflow>
      )}
      {!hidden && !rail && <SidebarRowsGrip section="engines" total={shown.length} title={t("nav.externalSessions")} />}
    </>
  );
}

/** Logged in → green dot; installed without a session → hint; missing → "install"; unknown → nothing. */
function EngineState({ engine }: { engine: EngineStatus | undefined }) {
  const t = useT();
  if (!engine) return null;
  if (engine.installed && engine.logged_in) return <span className="sidebar__running" title={t("engine.loggedIn")} />;
  return <span className="sidebar__soon">{engine.installed ? t("engine.noSession") : t("engine.install")}</span>;
}

/**
 * An engine's logo in the list: Claude Code and Codex (and the other model makers) as their own round app icons; a
 * coding agent's one-colour mark bare, with no tile around it.
 */
function SessionIcon({ engine }: { engine: string }) {
  const brand = engineBrand(engine);
  const app = brand === "claude" || brand === "codex" || brand === "gemini" || brand === "openai" || brand === "ollama";
  return app ? (
    <EngineIcon engine={engine} tile size={20} />
  ) : (
    <span className="kindtile" style={{ width: 20, height: 20 }}>
      <EngineIcon engine={engine} size={17} />
    </span>
  );
}
