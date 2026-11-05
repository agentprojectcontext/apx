import { Button, Icons } from "@apx/ui";
import { Suspense } from "react";
import { choiceLabel, effectiveChoice, refLabel, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelList } from "../../lazy.ts";
import type { ModelChoiceProps } from "./ModelPickers.tsx";

/** What a model picker opens: the current choice, the router or the inherited default, and every model. */
export function ModelChoiceMenu(props: ModelChoiceProps & { empty: boolean }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const { value, empty } = props;
  const pick = props.onChange;
  const config = useModels((s) => s.config);
  const own = value?.model;
  const effective = effectiveChoice(value, props.inherited, config);
  const current = choiceLabel(effective, catalog, config);
  const inheritedChoice = effectiveChoice(null, props.inherited, config);
  const inherited = inheritedChoice.model ? choiceLabel(inheritedChoice, catalog, config) : t("models.router");
  const first = config?.router.chain[0];
  const router = first
    ? t(config?.router.rules.length ? "models.routerSummaryRules" : "models.routerSummary", {
        model: refLabel(first, catalog),
      })
    : t(config?.router.rules.length ? "models.routerRules" : "models.router");
  return (
    <div className="mchoice">
      {effective.model && (
        <div className="mchoice__current" role="status" title={current}>
          {t("models.currentChoice", { model: current })}
        </div>
      )}
      {!empty && (
        <>
          <Fallback
            active={value != null && !own}
            title={router}
            action={t("models.routerOnly")}
            onPick={() => pick({ router: true })}
          />
          <Fallback
            active={value == null}
            title={t("models.inheritedChoice", {
              source: props.none?.title ?? t("models.installDefault"),
              model: inherited,
            })}
            action={props.none?.action ?? t("models.useDefault")}
            onPick={() => pick(null)}
          />
          <div className="mchoice__label">{t("models.ownModel")}</div>
        </>
      )}
      <Suspense fallback={null}>
        <ModelList
          value={own}
          effortValue={effective.model}
          {...(props.only ? { only: props.only } : {})}
          onPick={(model) => pick({ model, router: own === model ? (value?.router ?? true) : true })}
          onEffort={(model) => props.onChange({ model, router: effective.router })}
        />
      </Suspense>
    </div>
  );
}

/** What runs with no model of its own: a button goes back to it, or it reads "in use". */
function Fallback(props: { active: boolean; title: string; action: string; onPick: () => void }) {
  const t = useT();
  return (
    <div className="mchoice__fallback">
      <span className="mchoice__title" title={props.title}>
        {props.title}
      </span>
      {props.active ? (
        <span className="mchoice__inuse">
          <Icons.Check size={14} />
          {t("models.inUse")}
        </span>
      ) : (
        <Button size="sm" variant="secondary" onClick={props.onPick}>
          {props.action}
        </Button>
      )}
    </div>
  );
}
