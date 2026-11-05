import type { CatalogEngine, ModelChoice } from "@apx/protocol";
import { Icons, Popover } from "@apx/ui";
import { type ReactNode, Suspense, useState } from "react";
import { choiceLabel, effectiveChoice, forAgents, inCatalog, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelChoiceMenu } from "../../lazy.ts";

/**
 * The select-like button a picker opens from (a plain element: the Popover merges its trigger props into it).
 * Warns when its ref is not in the catalog.
 */
export function trigger(o: {
  text: string;
  label: string;
  warnText: string;
  warn?: boolean;
  className?: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={o.disabled}
      className={o.className ?? "selectbtn"}
      aria-label={o.label}
      title={o.warn ? o.warnText : o.text}
    >
      {o.warn ? <Icons.TriangleAlert size={12} className="selectbtn__warn" /> : o.icon}
      <span className="selectbtn__text">{o.text}</span>
      <Icons.ChevronDown size={12} className="selectbtn__chevron" />
    </button>
  );
}

/** A primary model, the router alone, or an inherited choice; inheritance is not an explicit router choice. */
export type ModelChoiceProps = {
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
  disabled?: boolean;
  /** Which engines it offers (a CLI's own session: that CLI); by default the model APIs agents run on. */
  only?: (e: CatalogEngine) => boolean;
};

/** The trigger is on the first screen (the composer has one); what it opens loads when it first opens. */
export function ModelChoicePicker(props: ModelChoiceProps) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const config = useModels((s) => s.config);
  const effective = effectiveChoice(props.value, props.inherited, config);
  const text = props.text ?? choiceLabel(effective, catalog, config);
  const load = useModels((s) => s.catalogLoad);
  const empty =
    load === "ready" &&
    !catalog.some(props.only ?? forAgents) &&
    !effective.model &&
    !config?.router.chain.length &&
    !config?.router.rules.length;
  const warn = Boolean(effective.model) && catalog.length > 0 && !inCatalog(effective.model ?? "", catalog);
  return (
    <Popover
      open={open && !props.disabled}
      onOpenChange={setOpen}
      width={560}
      align={props.align ?? "end"}
      label={props.label}
      trigger={trigger({
        text: empty && !props.disabled ? t("models.noneConnected") : text,
        disabled: props.disabled,
        label: props.label,
        warn,
        warnText: t("models.notInCatalog"),
        className: props.className,
        icon: props.icon,
      })}
    >
      <Suspense fallback={null}>
        <ModelChoiceMenu {...props} empty={empty} />
      </Suspense>
    </Popover>
  );
}
