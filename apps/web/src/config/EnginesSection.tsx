import type { EngineStatus } from "@apx/protocol";
import { Button, EmptyState, Icons, ProjectTile, Skeleton } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { loadEngines } from "../data/engines.ts";
import { loadCatalog, loadModelsConfig } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { ModelCatalog } from "./models/ModelCatalog.tsx";
import { ProvidersGrid } from "./ProvidersGrid.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";

type Look = { icon: ReactNode; tone: "brand" | "ink"; kind: MessageKey; login: MessageKey };

const LOOK: Record<string, Look> = {
  native: { icon: <Icons.Sparkles />, tone: "brand", kind: "engine.kind.native", login: "engine.login.native" },
  claude: { icon: <Icons.Code />, tone: "ink", kind: "engine.kind.cli", login: "engine.login.claude" },
  codex: { icon: <Icons.Terminal />, tone: "ink", kind: "engine.kind.cli", login: "engine.login.codex" },
};
/** Any Agent Client Protocol CLI (OpenCode, Qwen Code, Cursor…). */
const ACP_LOOK: Look = { icon: <Icons.Bot />, tone: "ink", kind: "engine.kind.acp", login: "engine.login.acp" };
const lookOf = (id: string): Look => LOOK[id] ?? ACP_LOOK;

/**
 * Engines as cards: the CLIs that run turns on your subscriptions (Claude Code and Codex always, ACP agents when
 * installed), the model APIs our own loop calls (add your own), and every model each one offers.
 */
export function EnginesSection() {
  const t = useT();
  const engines = useData((s) => s.engines);
  const load = useData((s) => s.enginesLoad);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    void loadEngines();
    void loadCatalog();
    void loadModelsConfig();
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    await loadEngines(true);
    setRefreshing(false);
  };

  return (
    <>
      <SectionHead
        title={t("config.engines")}
        lead={t("engines.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            loading={refreshing}
            onClick={refresh}
          >
            {t("engines.recheck")}
          </Button>
        }
      />
      {load === "unavailable" ? (
        <EmptyState
          variant="dashed"
          icon={<Icons.Server />}
          title={t("engines.unavailable.title")}
          action={
            <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}>
              {t("common.retry")}
            </Button>
          }
        >
          {t("engines.unavailable.body")}
        </EmptyState>
      ) : load !== "ready" && !engines.length ? (
        <div className="engines">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="block" height={112} />
          ))}
        </div>
      ) : (
        <div className="engines">
          {engines
            // Our own loop is shown through its providers below; ACP agents only when installed here.
            .filter((e) => e.id !== "native" && (e.installed || e.id === "claude" || e.id === "codex"))
            .map((e) => (
              <EngineCard key={e.id} engine={e} />
            ))}
        </div>
      )}
      <SubHead>{t("providers.title")}</SubHead>
      <p className="config__hint">{t("providers.lead")}</p>
      <ProvidersGrid />
      <ModelCatalog />
    </>
  );
}

function EngineCard({ engine: e }: { engine: EngineStatus }) {
  const t = useT();
  const look = lookOf(e.id);
  const hint = !e.installed ? t("engines.notInstalled") : !e.logged_in ? t(look.login) : undefined;
  const kind = t(look.kind);
  return (
    <div className="engine">
      <div className="engine__top">
        <ProjectTile tone={look.tone} icon={look.icon} size={36} shape={e.id === "native" ? "square" : "circle"} />
        <div className="engine__titles">
          <div className="engine__name">
            {e.label}
            {e.version && <span className="engine__version">v{e.version.replace(/^v/, "")}</span>}
          </div>
          <div className="engine__kind">{e.detail ? `${kind} · ${e.detail}` : kind}</div>
        </div>
      </div>
      <ol className="engine__steps" aria-label={t("engines.status")}>
        <Step done={e.installed} label={t("engines.installed")} />
        <Step done={e.logged_in} label={t("engine.loggedIn")} />
      </ol>
      {hint && <p className="engine__hint">{hint}</p>}
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={done ? "engine__step is-done" : "engine__step"}>
      {done ? <Icons.CircleCheck size={14} /> : <Icons.CircleDashed size={14} />}
      {label}
    </li>
  );
}
