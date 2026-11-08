import type { CatalogEngine, ModelChoice } from "@apx/protocol";
import { Icons, Popover, Skeleton } from "@apx/ui";
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
  /** After the text, quieter (the effort, in the composer). */
  extra?: ReactNode;
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
      {o.extra}
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
  /** The composer's short picker: models with their tags, what runs now and after, and the effort. */
  slim?: boolean;
  /** After the trigger text (the effort, in the composer). */
  extra?: ReactNode;
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
      width={props.slim ? 340 : 560}
      align={props.align ?? "end"}
      {...(props.slim ? { side: "top" as const } : {})}
      label={props.label}
      trigger={trigger({
        text: empty && !props.disabled ? t("models.noneConnected") : text,
        disabled: props.disabled,
        label: props.label,
        warn,
        warnText: t("models.notInCatalog"),
        className: props.className,
        icon: props.icon,
        extra: props.extra,
      })}
    >
      <Suspense fallback={<ModelMenuSkeleton slim={props.slim} />}>
        <ModelChoiceMenu {...props} empty={empty} />
      </Suspense>
    </Popover>
  );
}

/** The picker's shape while what it lists loads: the search, a few rows, then what runs now and the effort. */
export function ModelMenuSkeleton({
  slim,
  list = true,
  foot = true,
}: {
  slim?: boolean | undefined;
  list?: boolean;
  foot?: boolean;
}) {
  const row = (key: string, width: string, lead = "56px") => (
    <span key={key} className="mskel__row">
      {slim && <Skeleton width={lead} height={10} />}
      <Skeleton width={width} height={10} />
    </span>
  );
  return (
    <div className="mskel" role="status" aria-busy="true">
      {list && (
        <>
          <Skeleton shape="block" height={32} className="mskel__search" />
          <span className="mskel__rows">
            {["58%", "44%", "66%", "50%", "38%"].map((w, i) => (
              <span key={w} className="mskel__row">
                <Skeleton width={14} height={14} shape="circle" style={{ opacity: i ? 0 : 1 }} />
                <Skeleton width={w} height={10} />
              </span>
            ))}
          </span>
        </>
      )}
      {foot && (
        <span className="mskel__foot">
          {row("now", "52%")}
          {row("then", "40%")}
          {row("effort", "70%")}
        </span>
      )}
    </div>
  );
}
