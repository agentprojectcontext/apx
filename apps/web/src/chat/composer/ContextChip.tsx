import { Meter, Popover, Tooltip } from "@apx/ui";
import { type ComponentPropsWithoutRef, forwardRef, useState } from "react";
import { formatNumber } from "../../common/format.ts";
import { useT } from "../../i18n/index.ts";
import { ContextCard, type ContextCardProps } from "./ContextCard.tsx";
import { tokens as k, shareOf } from "./context.ts";

/**
 * How full the chat's context is: the tokens in use ("82k") beside a ring that fills with the model's window (empty
 * while the window is not known), or what the chat read and wrote ("202k / 101k") when the engine reports no context;
 * a turning ring while its figures load. Opens what fills it.
 */
export function ContextChip(props: ContextCardProps & { loading: boolean }) {
  const { context, spent, loading } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const share = shareOf(context);
  const percent = share != null ? formatNumber(share, { style: "percent", maximumFractionDigits: 0 }) : undefined;
  const label = context
    ? context.window && percent
      ? t("composer.contextShare", { share: percent, used: k(context.used), window: k(context.window) })
      : t("composer.contextUsed", { used: k(context.used) })
    : spent != null
      ? spent.cached
        ? t("composer.spentCached", { input: k(spent.input), output: k(spent.output), cached: k(spent.cached) })
        : t("composer.spent", { input: k(spent.input), output: k(spent.output) })
      : t("panel.usage");
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      width={320}
      label={t("ctx.title")}
      className="ctxcard__pop"
      trigger={
        <ChipButton label={label} open={open}>
          {context ? (
            <span className={`ctxchip__text${percent ? " is-share" : ""}`}>{k(context.used)}</span>
          ) : (
            spent != null && (
              <span className="ctxchip__text">
                {k(spent.input)} / {k(spent.output)}
              </span>
            )
          )}
          {loading ? (
            <Meter shape="ring" size="sm" value={1} max={4} label={label} className="ctxchip__loading" />
          ) : (
            <Meter
              shape="ring"
              size="sm"
              value={context?.window ? context.used : 0}
              max={context?.window ?? 1}
              label={label}
              {...(percent ? { valueText: percent } : {})}
            />
          )}
        </ChipButton>
      }
    >
      <ContextCard {...props} onDone={() => setOpen(false)} />
    </Popover>
  );
}

/** The chip itself: the Popover hands it its trigger props, the tooltip says the whole figure. */
const ChipButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { label: string; open: boolean }>(
  function ChipButton({ label, open, children, ...rest }, ref) {
    return (
      <Tooltip content={label} side="top">
        <button
          ref={ref}
          type="button"
          {...rest}
          className={`ctxchip${open ? " is-open" : ""}`}
          aria-label={label}
          aria-expanded={open}
        >
          {children}
        </button>
      </Tooltip>
    );
  },
);
