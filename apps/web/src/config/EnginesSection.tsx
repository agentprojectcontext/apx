import type { EngineStatus } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons, ProjectTile, Skeleton } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { loadEngines, setDefaultEngine } from "../data/engines.ts";
import { loadCatalog, loadModelsConfig } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { DefaultModel } from "./models/DefaultModel.tsx";
import { ModelCatalog } from "./models/ModelCatalog.tsx";
import { RouterEditor } from "./models/RouterEditor.tsx";
import { SectionHead } from "./SectionHead.tsx";

const LOOK: Record<EngineStatus["id"], { icon: ReactNode; tone: "brand" | "ink"; kind: MessageKey }> = {
  native: { icon: <Icons.Sparkles />, tone: "brand", kind: "engine.kind.native" },
  claude: { icon: <Icons.Code />, tone: "ink", kind: "engine.kind.cli" },
  codex: { icon: <Icons.Terminal />, tone: "ink", kind: "engine.kind.cli" },
};

const LOGIN_HINT: Record<EngineStatus["id"], MessageKey> = {
  native: "engine.login.native",
  claude: "engine.login.claude",
  codex: "engine.login.codex",
};

/** Engines (installed → signed in → default), the install default model, the router and the model catalog. */
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
          {engines.map((e) => (
            <EngineCard key={e.id} engine={e} />
          ))}
        </div>
      )}
      <DefaultModel />
      <RouterEditor />
      <ModelCatalog />
    </>
  );
}

function EngineCard({ engine: e }: { engine: EngineStatus }) {
  const t = useT();
  const look = LOOK[e.id];
  const usable = e.installed && e.logged_in;
  const [busy, setBusy] = useState(false);
  const hint = !e.installed ? t("engines.notInstalled") : !e.logged_in ? t(LOGIN_HINT[e.id]) : undefined;
  const kind = t(look.kind);
  return (
    <div className={e.default ? "engine is-default" : "engine"}>
      <div className="engine__top">
        <ProjectTile tone={look.tone} icon={look.icon} size={36} shape={e.id === "native" ? "square" : "circle"} />
        <div className="engine__titles">
          <div className="engine__name">
            {e.label}
            {e.version && <span className="engine__version">v{e.version.replace(/^v/, "")}</span>}
          </div>
          <div className="engine__kind">{e.detail ? `${kind} · ${e.detail}` : kind}</div>
        </div>
        {e.default ? (
          <Badge tone="brand" dot>
            {t("engine.default")}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!usable}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await setDefaultEngine(e.id);
              setBusy(false);
            }}
          >
            {t("engines.useDefault")}
          </Button>
        )}
      </div>
      <ol className="engine__steps" aria-label={t("engines.status")}>
        <Step done={e.installed} label={t("engines.installed")} />
        <Step done={e.logged_in} label={t("engine.loggedIn")} />
        <Step done={e.default} label={t("engine.default")} />
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
