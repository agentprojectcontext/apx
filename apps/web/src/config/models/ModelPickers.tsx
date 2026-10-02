import type { ModelChoice, ModelRef } from "@apx/protocol";
import { Icons, Popover } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { choiceLabel, inCatalog, refLabel, useModels } from "../../data/models.ts";
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
      />
    </Popover>
  );
}

/**
 * An agent's model: the router (everyone's default), or its own model tried first with the router as fallback.
 * "Router" maps to null (no choice of its own).
 */
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
  /** The first option, when null means something else than the router (a chat: "the agent's model"). */
  none?: { title: string; desc: string };
  align?: "start" | "end";
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const { value } = props;
  const pick = (choice: ModelChoice | null) => {
    setOpen(false);
    props.onChange(choice);
  };
  const own = value?.model;
  const text = props.text ?? (own ? choiceLabel(value, catalog) : t("models.router"));
  const warn = Boolean(own) && catalog.length > 0 && !inCatalog(own ?? "", catalog);
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
        <Mode
          selected={!own}
          title={props.none?.title ?? t("models.router")}
          desc={props.none?.desc ?? t("models.routerOnlyDesc")}
          onPick={() => pick(null)}
        />
        <div className="mchoice__label">{t("models.ownModel")}</div>
        <ModelList value={own} onPick={(model) => pick({ model, router: true })} />
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
