import type { EngineStatus } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons, ProjectTile, Skeleton } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { loadEngines, setDefaultEngine } from "../data/engines.ts";
import { useData } from "../data/state.ts";
import { SectionHead } from "./SectionHead.tsx";

const LOOK: Record<EngineStatus["id"], { icon: ReactNode; tone: "brand" | "ink"; kind: string }> = {
  native: { icon: <Icons.Sparkles />, tone: "brand", kind: "Motor propio de APX" },
  claude: { icon: <Icons.Code />, tone: "ink", kind: "Sesión externa · CLI" },
  codex: { icon: <Icons.Terminal />, tone: "ink", kind: "Sesión externa · CLI" },
};

const LOGIN_HINT: Record<EngineStatus["id"], string> = {
  native: "Configurá una clave de modelo en el core.",
  claude: "Abrí Claude Code en una terminal e iniciá sesión con tu cuenta.",
  codex: "Corré codex login en una terminal.",
};

/** Motores y modelos: installed → logged in → default, from engines.status. */
export function EnginesSection() {
  const engines = useData((s) => s.engines);
  const load = useData((s) => s.enginesLoad);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    void loadEngines();
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    await loadEngines(true);
    setRefreshing(false);
  };

  return (
    <>
      <SectionHead
        title="Motores y modelos"
        lead="Un motor corre los turnos de un agente: el propio de APX o una CLI externa con tu suscripción. Los agentes usan el motor por defecto salvo que elijas otro en Agentes."
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            loading={refreshing}
            onClick={refresh}
          >
            Revisar de nuevo
          </Button>
        }
      />
      {load === "unavailable" ? (
        <EmptyState
          variant="dashed"
          icon={<Icons.Server />}
          title="El core todavía no informa los motores"
          action={
            <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}>
              Reintentar
            </Button>
          }
        >
          Actualizá y reiniciá el core para ver qué está instalado y con sesión.
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
    </>
  );
}

function EngineCard({ engine: e }: { engine: EngineStatus }) {
  const look = LOOK[e.id];
  const usable = e.installed && e.logged_in;
  const [busy, setBusy] = useState(false);
  const hint = !e.installed
    ? "No está instalado en esta computadora. Instalalo y tocá Revisar de nuevo."
    : !e.logged_in
      ? LOGIN_HINT[e.id]
      : undefined;
  return (
    <div className={e.default ? "engine is-default" : "engine"}>
      <div className="engine__top">
        <ProjectTile tone={look.tone} icon={look.icon} size={36} shape={e.id === "native" ? "square" : "circle"} />
        <div className="engine__titles">
          <div className="engine__name">
            {e.label}
            {e.version && <span className="engine__version">v{e.version.replace(/^v/, "")}</span>}
          </div>
          <div className="engine__kind">{e.detail ? `${look.kind} · ${e.detail}` : look.kind}</div>
        </div>
        {e.default ? (
          <Badge tone="brand" dot>
            Por defecto
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
            Usar por defecto
          </Button>
        )}
      </div>
      <ol className="engine__steps" aria-label="Estado">
        <Step done={e.installed} label="Instalado" />
        <Step done={e.logged_in} label="Sesión iniciada" />
        <Step done={e.default} label="Por defecto" />
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
