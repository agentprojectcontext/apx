import type { CatalogEngine, ModelChoice, ModelRef } from "@apx/protocol";
import { Button, Icons, Popover } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { choiceLabel, effectiveChoice, inCatalog, refLabel, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelList } from "./ModelList.tsx";

/**
 * The select-like button a picker opens from (a plain element: the Popover merges its trigger props into it).
 * Warns when its ref is not in the catalog.
 */
function trigger(o: {
  text: string;
  label: string;
  warnText: string;
  warn?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={o.className ?? "selectbtn"}
      aria-label={o.label}
      title={o.warn ? o.warnText : o.text}
    >
      {o.warn ? <Icons.TriangleAlert size={12} className="selectbtn__warn" /> : o.icon}
      <span className="selectbtn__text">{o.text}</span>
      <Icons.ChevronDown size={12} />
    </button>
  );
}

/** One model ref from the catalog (router chain, rule targets). Without `value` it shows `placeholder`. */
export function ModelRefPicker(props: {
  value?: ModelRef;
  onChange: (ref: ModelRef) => void;
  label: string;
  placeholder?: string;
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const { value } = props;
  const text = value ? refLabel(value, catalog) : (props.placeholder ?? props.label);
  const warn = Boolean(value) && catalog.length > 0 && !inCatalog(value ?? "", catalog);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={360}
      label={props.label}
      trigger={trigger({ text, label: props.label, warn, warnText: t("models.notInCatalog") })}
    >
      <ModelList
        value={value}
        onPick={(ref) => {
          setOpen(false);
          props.onChange(ref);
        }}
        onEffort={props.onChange}
      />
    </Popover>
  );
}

/** A primary model, the router alone, or an inherited choice; inheritance is not an explicit router choice. */
export function ModelChoicePicker(props: {
  value: ModelChoice | null;
  onChange: (choice: ModelChoice | null) => void;
  label: string;
  /** Trigger text; defaults to the choice's own label. */
  text?: string;
  /** Trigger class: a select button by default, a chip on team cards. */
  className?: string;
  /** Before the trigger text (the engine's mark in the composer). */
  icon?: ReactNode;
  /** Null inherits this choice, or the install default. */
  inherited?: ModelChoice;
  none?: { title: string; desc: string; action: string };
  align?: "start" | "end";
  /** Which engines it offers (a CLI's own session: that CLI); by default the model APIs agents run on. */
  only?: (e: CatalogEngine) => boolean;
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const { value } = props;
  const pick = (choice: ModelChoice | null) => {
    setOpen(false);
    props.onChange(choice);
  };
  const config = useModels((s) => s.config);
  const own = value?.model;
  const effective = effectiveChoice(value, props.inherited, config);
  const current = choiceLabel(effective, catalog, config);
  const inherited = choiceLabel(effectiveChoice(null, props.inherited, config), catalog, config);
  const text = props.text ?? current;
  const warn = Boolean(effective.model) && catalog.length > 0 && !inCatalog(effective.model ?? "", catalog);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={380}
      align={props.align ?? "end"}
      label={props.label}
      trigger={trigger({
        text,
        label: props.label,
        warn,
        warnText: t("models.notInCatalog"),
        className: props.className,
        icon: props.icon,
      })}
    >
      <div className="mchoice">
        <div className="mchoice__fallback" role="status">
          <span className="mchoice__text">
            <span className="mchoice__title">{t("models.currentChoice", { model: current })}</span>
            <span className="mchoice__desc">
              {value == null
                ? (props.none?.title ?? t("models.installDefault"))
                : own
                  ? t("models.ownModel")
                  : t("models.router")}
            </span>
            {(effective.router || !effective.model) && (
              <span className="mchoice__desc">{t("models.routerOnlyDesc")}</span>
            )}
          </span>
        </div>
        <div className="mchoice__label">{t("models.ownModel")}</div>
        <ModelList
          value={own}
          {...(props.only ? { only: props.only } : {})}
          onPick={(model) => pick({ model, router: own === model ? (value?.router ?? true) : true })}
          onEffort={(model) => props.onChange({ model, router: value?.router ?? true })}
        />
        <Fallback
          active={value != null && !own}
          title={choiceLabel({ router: true }, catalog, config)}
          desc={t("models.routerOnlyDesc")}
          action={t("models.routerOnly")}
          onPick={() => pick({ router: true })}
        />
        <Fallback
          active={value == null}
          title={t("models.inheritedChoice", {
            source: props.none?.title ?? t("models.installDefault"),
            model: inherited,
          })}
          desc={props.none?.desc ?? ""}
          action={props.none?.action ?? t("models.useDefault")}
          onPick={() => pick(null)}
        />
      </div>
    </Popover>
  );
}

/** What runs with no model of its own: a button goes back to it, or it reads "in use". */
function Fallback(props: { active: boolean; title: string; desc: string; action: string; onPick: () => void }) {
  const t = useT();
  return (
    <div className="mchoice__fallback">
      <span className="mchoice__text">
        <span className="mchoice__title">{props.title}</span>
        <span className="mchoice__desc">{props.desc}</span>
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
