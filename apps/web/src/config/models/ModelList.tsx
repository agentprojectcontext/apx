import type { CatalogEngine, ModelRef } from "@apx/protocol";
import { Badge, EngineIcon, Icons, SearchField } from "@apx/ui";
import { useMemo, useState } from "react";
import { baseRef, forAgents, refLabel, splitRef, useModels, withEffort } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { EffortRow } from "./RefSelect.tsx";

type Group = { engine: CatalogEngine; showDefault: boolean; models: CatalogEngine["models"] };

/** Catalog engines filtered by a query; chat models only unless `all`. */
export function filterCatalog(catalog: readonly CatalogEngine[], q: string, all: boolean): Group[] {
  const needle = q.trim().toLowerCase();
  return catalog
    .map((engine) => {
      const engineHit = !needle || `${engine.id} ${engine.label}`.toLowerCase().includes(needle);
      const models = engine.models.filter(
        (m) => (all || m.chat) && (engineHit || `${engine.id}/${m.id} ${m.name}`.toLowerCase().includes(needle)),
      );
      return { engine, showDefault: engineHit, models };
    })
    .filter((g) => g.showDefault || g.models.length > 0);
}

/**
 * Searchable catalog grouped by engine, chat models only (voice, image and embedding models never run a turn).
 * An engine alone picks that engine's own default model.
 */
export function ModelList({
  value,
  onPick,
  onEffort,
  only = forAgents,
}: {
  value?: ModelRef;
  onPick: (ref: ModelRef) => void;
  /** Changes the picked model's effort (the list stays open); without it, no effort row. */
  onEffort?: (ref: ModelRef) => void;
  /** Which engines it offers; by default what agents may run on (model APIs that answer now). */
  only?: (e: CatalogEngine) => boolean;
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const load = useModels((s) => s.catalogLoad);
  const [q, setQ] = useState("");
  const groups = useMemo(() => filterCatalog(catalog.filter(only), q, false), [catalog, only, q]);
  const picked = value ? baseRef(value) : undefined;
  /** Picking the same model again keeps the effort it had. */
  const sameModel = (ref: ModelRef) => (picked === ref && value ? splitRef(value).effort : undefined);

  return (
    <div className="mlist">
      <SearchField
        size="sm"
        autoFocus
        placeholder={t("models.search")}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <div className="mlist__scroll" role="listbox" aria-label={t("models.catalog")}>
        {groups.length === 0 && (
          <p className="mlist__empty">
            {load === "unavailable" ? t("models.catalogUnavailable") : t("models.noMatch")}
          </p>
        )}
        {groups.map(({ engine: e, showDefault, models }) => (
          <div key={e.id} className="mlist__group">
            <div className="mlist__engine">
              <EngineIcon engine={e.id} size={14} />
              <span>{e.label}</span>
              {!e.available && (
                <Badge tone="warning" title={e.detail}>
                  {t("models.unavailable")}
                </Badge>
              )}
            </div>
            {/* Only a CLI has a default model of its own; a model API runs with its model named. */}
            {showDefault && e.kind === "harness" && (
              <Option
                selected={picked === e.id}
                name={refLabel(e.id, catalog)}
                sub={e.id}
                onPick={() => onPick(withEffort(e.id, sameModel(e.id)))}
              />
            )}
            {models.map((m) => {
              const ref = `${e.id}/${m.id}`;
              return (
                <Option
                  // Engines may list one model under two names ("Default", "Opus …").
                  key={`${m.id}:${m.name}`}
                  selected={picked === ref}
                  name={m.name}
                  sub={ref}
                  onPick={() => onPick(withEffort(ref, sameModel(ref)))}
                />
              );
            })}
          </div>
        ))}
      </div>
      {value && onEffort && <EffortRow value={value} onChange={onEffort} />}
    </div>
  );
}

function Option(props: { selected: boolean; name: string; sub: string; onPick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={props.selected} className="mlist__opt" onClick={props.onPick}>
      <span className="mlist__check">{props.selected && <Icons.Check size={14} />}</span>
      <span className="mlist__name">{props.name}</span>
      <span className="mlist__ref">{props.sub}</span>
    </button>
  );
}
