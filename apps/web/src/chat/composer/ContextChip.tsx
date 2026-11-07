import { Icons, Meter, Tooltip } from "@apx/ui";
import { formatNumber } from "../../common/format.ts";
import { useT } from "../../i18n/index.ts";
import { go, useNav } from "../../shell/nav.ts";
import { tokens as k, shareOf } from "./context.ts";

/**
 * How full the chat's context is ("64%" with a ring) when the model's window is known, the tokens alone when it is
 * not, or what the chat read and wrote ("202k / 101k") when the engine reports no context; toggles the Usage panel
 * and stays pressed while it is open.
 */
export function ContextChip({
  context,
  spent,
}: {
  context: { used: number; window?: number } | undefined;
  spent: { input: number; output: number; cached: number } | undefined;
}) {
  const t = useT();
  const open = useNav((s) => s.panel === "usage");
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
    <Tooltip content={label} side="top">
      <button
        type="button"
        className={`ctxchip${open ? " is-open" : ""}`}
        aria-label={label}
        aria-pressed={open}
        onClick={() => go.togglePanel("usage")}
      >
        {context?.window && percent ? (
          <Meter shape="ring" size="md" value={context.used} max={context.window} label={label} valueText={percent} />
        ) : (
          <Icons.Zap size={12} />
        )}
        {context ? (
          <span className={`ctxchip__text${percent ? " is-share" : ""}`}>{percent ?? k(context.used)}</span>
        ) : (
          spent != null && (
            <span className="ctxchip__text">
              {k(spent.input)} / {k(spent.output)}
            </span>
          )
        )}
      </button>
    </Tooltip>
  );
}
