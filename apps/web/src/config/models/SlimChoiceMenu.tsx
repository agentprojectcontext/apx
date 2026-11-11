import "../../styles/model-menus.css";
import type { ModelRef } from "@apx/protocol";
import { Button, EngineIcon, Icons } from "@apx/ui";
import { Suspense, useEffect, useRef } from "react";
import {
  baseRef,
  choiceLabel,
  effectiveChoice,
  forAgents,
  loadCatalog,
  splitRef,
  useModels,
} from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelList } from "../../lazy.ts";
import { type ModelChoiceProps, ModelMenuSkeleton } from "./ModelPickers.tsx";
import { EffortRow } from "./RefSelect.tsx";

/**
 * The composer's model picker: every model by provider, the chosen one and the router's first marked; under them what
 * runs now and what takes over if it fails, a way back to the router or to the agent's model, and the effort.
 */
export function SlimChoiceMenu(props: ModelChoiceProps & { empty: boolean }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const config = useModels((s) => s.config);
  const load = useModels((s) => s.catalogLoad);
  const { value, empty } = props;
  // Until the catalog answers, the list keeps its shape instead of saying there is nothing.
  const loading = load !== "ready" && load !== "unavailable" && !catalog.some(props.only ?? forAgents);
  const pick = props.onChange;
  const own = value?.model;
  const effective = effectiveChoice(value, props.inherited, config);
  const routerFirst = config?.router.chain[0];
  // Beside its provider's mark a model reads by its own name; its effort is the row under them.
  const name = (ref: ModelRef) => {
    const { engine, model } = splitRef(ref);
    return model ?? catalog.find((e) => e.id === engine)?.label ?? engine;
  };
  // With rules the router picks per turn: it is named by its route, not by a model it may not use.
  const routerLabel = config?.router.rules.length
    ? choiceLabel({ router: true }, catalog, config)
    : routerFirst
      ? t("slim.viaRouter", { model: name(routerFirst) })
      : t("models.router");
  const chosen = own ? baseRef(own) : undefined;
  const router = routerFirst ? baseRef(routerFirst) : undefined;

  // What runs now, then each model that takes over in order when the one before fails.
  const slots: { key: string; ref: ModelRef | undefined; label: string; now: boolean }[] = effective.model
    ? [
        { key: "now", ref: effective.model, label: name(effective.model), now: true },
        ...(effective.fallbacks ?? []).map((ref, i) => ({
          key: `fallback:${i}`,
          ref,
          label: name(ref),
          now: false,
        })),
        ...(effective.router ? [{ key: "router", ref: routerFirst, label: routerLabel, now: false }] : []),
      ]
    : [{ key: "router", ref: routerFirst, label: routerLabel, now: true }];
  const routerOnly = value != null && !own;

  useEffect(() => {
    if (load === "idle") void loadCatalog();
  }, [load]);

  // The chosen model in view when it opens (the list loads a moment later).
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    const reveal = () => {
      const opt = box.current?.querySelector<HTMLElement>('.mlist__opt[aria-selected="true"]');
      const list = opt?.closest<HTMLElement>(".mlist__scroll");
      if (opt && list)
        list.scrollTop += opt.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 3;
      else if (tries++ < 10) timer = window.setTimeout(reveal, 50);
    };
    timer = window.setTimeout(reveal, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div ref={box} className="mchoice mslim">
      <Suspense fallback={<ModelMenuSkeleton slim foot={false} />}>
        {loading ? (
          <ModelMenuSkeleton slim foot={false} />
        ) : (
          <ModelList
            value={own}
            {...(props.only ? { only: props.only } : {})}
            onPick={(model) => pick({ model, router: own === model ? (value?.router ?? true) : true })}
            tag={(ref) => {
              const base = baseRef(ref);
              return (
                <>
                  {base === chosen && <span className="mslim__chosen">{t("slim.chosen")}</span>}
                  {base === router && <span className="mslim__router">{t("slim.routerTag")}</span>}
                </>
              );
            }}
          />
        )}
      </Suspense>
      {!empty && (
        <div className="mslim__foot">
          {slots.map((s, i) => (
            <div key={s.key} className="mslim__slot" {...(s.now ? { role: "status" } : {})}>
              <span className="mslim__when">{i === 0 ? t("slim.now") : i === 1 ? t("slim.then") : ""}</span>
              {s.ref ? (
                <EngineIcon engine={splitRef(s.ref).engine} size={14} />
              ) : (
                <Icons.Sparkles size={14} className="mslim__auto" />
              )}
              <span className="mslim__name" title={s.label}>
                {s.label}
              </span>
              <span className={`mslim__note${s.now ? " is-now" : ""}`}>
                {t(s.now ? "models.inUse" : "slim.ifFails")}
              </span>
            </div>
          ))}
          <div className="mslim__actions">
            {!routerOnly && (
              <Button variant="ghost" size="sm" onClick={() => pick({ router: true })}>
                {t("slim.routerOnly")}
              </Button>
            )}
            {value != null && (
              <Button variant="ghost" size="sm" onClick={() => pick(null)}>
                {props.none?.action ?? t("models.useDefault")}
              </Button>
            )}
          </div>
          <EffortRow value={effective.model} onChange={(model) => pick({ model, router: effective.router })} />
        </div>
      )}
    </div>
  );
}
