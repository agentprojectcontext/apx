import type { EngineStatus } from "@apx/protocol";
import { EngineIcon, engineBrand, Icons } from "@apx/ui";
import { useEffect } from "react";
import { rememberSidebar, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";
import { SidebarNavRow } from "./SidebarNavRow.tsx";
import { SidebarSection } from "./SidebarSection.tsx";

/** Last opened engine first, with the same row actions and manual ordering as the other sections. */
export function ExternalSessionsNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.externalSessionsFolded);
  const saved = usePrefs((s) => s.engineOrder);
  const engines = useData((s) => s.engines);
  const view = useNav((s) => s.view);
  const engineId = useNav((s) => s.engineId);
  useEffect(() => {
    if (view === "engine" && engineId) rememberSidebar("engineOrder", engineId);
  }, [view, engineId]);
  const rank = new Map(saved.map((id, index) => [id, index]));
  const shown = engines
    .filter((engine) => engine.id !== "native" && engine.installed)
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const order = shown.map((engine) => engine.id);
  const move = (id: string, index: number) => {
    if (!order.includes(id)) return;
    const ids = order.filter((current) => current !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    setPrefs({ engineOrder: ids });
  };
  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.externalSessions")}
        folded={folded}
        onToggle={() => setPrefs({ externalSessionsFolded: !folded })}
      />
      {(!folded || rail) &&
        shown.map((engine, index) => (
          <SidebarNavRow
            key={engine.id}
            id={engine.id}
            kind="engine"
            label={engine.label}
            rail={rail}
            icon={<SessionIcon engine={engine.id} />}
            trailing={<EngineState engine={engine} />}
            active={view === "engine" && engineId === engine.id}
            onPick={() => go.engine(engine.id)}
            order={order}
            onMove={move}
            items={[
              { label: t("nav.open"), icon: <Icons.Terminal />, onSelect: () => go.engine(engine.id) },
              { label: t("nav.engineSettings"), icon: <Icons.Settings />, onSelect: () => go.config("external") },
              { type: "separator" },
              {
                label: t("nav.channelFirst"),
                icon: <Icons.ChevronUp />,
                disabled: index === 0,
                onSelect: () => move(engine.id, 0),
              },
              {
                label: t("nav.channelUp"),
                icon: <Icons.ChevronUp />,
                disabled: index === 0,
                onSelect: () => move(engine.id, index - 1),
              },
              {
                label: t("nav.channelDown"),
                icon: <Icons.ChevronDown />,
                disabled: index === order.length - 1,
                onSelect: () => move(engine.id, index + 1),
              },
            ]}
          />
        ))}
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
