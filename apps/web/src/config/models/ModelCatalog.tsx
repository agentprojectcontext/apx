import type { CatalogEngine } from "@apx/protocol";
import { Badge, Button, Checkbox, EngineIcon, Icons, SearchField, Skeleton } from "@apx/ui";
import { useMemo, useState } from "react";
import { dayLabel } from "../../common/format.ts";
import { loadCatalog, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { SubHead } from "../SectionHead.tsx";
import { filterCatalog } from "./ModelList.tsx";

/** The core caches each engine's list for a day; older than that it is stale. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * The engines of one kind and the models each offers, as they report them: the model APIs (`provider`, plans among
 * them) under Engines and models, the CLIs (`harness`) under External sessions.
 */
export function ModelCatalog({ kind, title, lead }: { kind: CatalogEngine["kind"]; title?: string; lead?: string }) {
  const t = useT();
  const every = useModels((s) => s.catalog);
  // An ACP agent that is not installed here has nothing to list.
  const catalog = useMemo(
    () => every.filter((e) => e.kind === kind && (e.available || !e.id.startsWith("acp:"))),
    [every, kind],
  );
  const load = useModels((s) => s.catalogLoad);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const groups = useMemo(() => filterCatalog(catalog, q, all), [catalog, q, all]);
  const refresh = async () => {
    setRefreshing(true);
    await loadCatalog(true);
    setRefreshing(false);
  };

  return (
    <div className="config__section">
      <div className="catalog__head">
        <SubHead>{title ?? t("models.catalog")}</SubHead>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.RefreshCw size={14} />}
          loading={refreshing}
          onClick={refresh}
        >
          {t("common.refresh")}
        </Button>
      </div>
      <p className="config__hint">{lead ?? t("models.catalogLead")}</p>
      <div className="catalog__tools">
        <SearchField
          size="sm"
          placeholder={t("models.search")}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Checkbox checked={all} onCheckedChange={setAll} label={t("models.showAll")} />
      </div>
      {load === "unavailable" ? (
        <p className="router__empty">{t("models.catalogUnavailable")}</p>
      ) : load !== "ready" && !catalog.length ? (
        <Skeleton shape="block" height={120} />
      ) : groups.length === 0 ? (
        <p className="router__empty">{t("models.noMatch")}</p>
      ) : (
        <div className="catalog">
          {groups.map((g) => (
            <EngineModels
              key={g.engine.id}
              engine={g.engine}
              models={g.models}
              forceOpen={Boolean(q.trim())}
              total={g.engine.models.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EngineModels(props: {
  engine: CatalogEngine;
  models: CatalogEngine["models"];
  total: number;
  forceOpen: boolean;
}) {
  const t = useT();
  const { engine: e, models } = props;
  const stale = e.fetched_at ? Date.now() - new Date(e.fetched_at).getTime() > STALE_MS : false;
  const [open, setOpen] = useState(false);
  return (
    <details
      className="catalog__engine"
      open={props.forceOpen || open}
      onToggle={(ev) => !props.forceOpen && setOpen(ev.currentTarget.open)}
    >
      <summary className="catalog__summary">
        <Icons.ChevronRight size={14} className="catalog__chev" />
        <EngineIcon engine={e.id} size={16} />
        <span className="catalog__label">{e.label}</span>
        <span className="catalog__id">{e.id}</span>
        <span className="catalog__meta">
          {t(e.kind === "harness" ? "models.kind.harness" : "models.kind.provider")} ·{" "}
          {t("models.count", { count: props.total })}
          {e.fetched_at && ` · ${t("models.fetchedAt", { when: dayLabel(e.fetched_at) })}`}
          {e.detail && (!e.available || stale) && ` · ${e.detail}`}
        </span>
        {!e.available ? (
          <Badge tone="warning">{t("models.unavailable")}</Badge>
        ) : stale ? (
          <Badge tone="warning">{t("models.stale")}</Badge>
        ) : (
          <Badge tone="brand" dot>
            {t("models.available")}
          </Badge>
        )}
      </summary>
      {models.length === 0 ? (
        <p className="router__empty">{e.available ? t("models.noChatModels") : t("models.engineOffline")}</p>
      ) : (
        <ul className="catalog__models">
          {models.map((m) => (
            <li key={`${m.id}:${m.name}`} className="catalog__model">
              <span className="catalog__name">
                {m.name}
                {!m.chat && <span className="chip">{t("models.notChat")}</span>}
              </span>
              <code className="catalog__ref">
                {e.id}/{m.id}
              </code>
              {m.description && <span className="catalog__desc">{m.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
