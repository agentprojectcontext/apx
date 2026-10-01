import type { ModelChoice, ModelRef } from "@apx/protocol";
import { Icons, Popover, Switch } from "@apx/ui";
import { useState } from "react";
import { choiceLabel, inCatalog, refLabel, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelList } from "./ModelList.tsx";

/**
 * The select-like button a picker opens from (a plain element: the Popover merges its trigger props into it).
 * Warns when its ref is not in the catalog.
 */
function trigger(o: { text: string; label: string; warnText: string; warn?: boolean; className?: string }) {
  return (
    <button
      type="button"
      className={o.className ?? "selectbtn"}
      aria-label={o.label}
      title={o.warn ? o.warnText : o.text}
    >
      {o.warn && <Icons.TriangleAlert size={12} className="selectbtn__warn" />}
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
      />
    </Popover>
  );
}

/**
 * An agent's (or the install's) model choice: the router alone, a model, or a model with the router as fallback.
 * `inherit` adds an "Install default" option that maps to null.
 */
export function ModelChoicePicker(props: {
  value: ModelChoice | null;
  onChange: (choice: ModelChoice | null) => void;
  label: string;
  /** Trigger text; defaults to the choice's own label. */
  text?: string;
  /** Label of the install default when the owner can go back to it (agents). */
  inherit?: string;
  /** Trigger class: a select button by default, a chip on team cards. */
  className?: string;
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const { value } = props;
  const pick = (choice: ModelChoice | null) => {
    setOpen(false);
    props.onChange(choice);
  };
  const text = props.text ?? (value ? choiceLabel(value, catalog) : (props.inherit ?? t("models.default")));
  const warn = Boolean(value?.model) && catalog.length > 0 && !inCatalog(value?.model ?? "", catalog);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={380}
      align="end"
      label={props.label}
      trigger={trigger({
        text,
        label: props.label,
        warn,
        warnText: t("models.notInCatalog"),
        className: props.className,
      })}
    >
      <div className="mchoice">
        {props.inherit !== undefined && (
          <Mode
            selected={value === null}
            title={props.inherit}
            desc={t("models.inheritDesc")}
            onPick={() => pick(null)}
          />
        )}
        <Mode
          selected={Boolean(value && !value.model)}
          title={t("models.routerOnly")}
          desc={t("models.routerOnlyDesc")}
          onPick={() => pick({ router: true })}
        />
        <div className="mchoice__label">{t("models.aModel")}</div>
        <ModelList
          value={value?.model}
          onPick={(model) => pick({ model, router: value?.model ? value.router : false })}
        />
        <div className="mchoice__fallback">
          <Switch
            size="sm"
            checked={Boolean(value?.model && value.router)}
            disabled={!value?.model}
            onCheckedChange={(router) => value?.model && props.onChange({ model: value.model, router })}
            label={t("models.useRouterOnFail")}
            description={t("models.useRouterOnFailDesc")}
          />
        </div>
      </div>
    </Popover>
  );
}

function Mode(props: { selected: boolean; title: string; desc: string; onPick: () => void }) {
  return (
    <button type="button" className="mchoice__mode" aria-pressed={props.selected} onClick={props.onPick}>
      <span className="mlist__check">{props.selected && <Icons.Check size={14} />}</span>
      <span className="mchoice__text">
        <span className="mchoice__title">{props.title}</span>
        <span className="mchoice__desc">{props.desc}</span>
      </span>
    </button>
  );
}
