import { Icons, Tooltip } from "@apx/ui";
import { useT } from "../../i18n/index.ts";
import { go, useNav } from "../../shell/nav.ts";
import { tokens as k } from "./context.ts";

const R = 7;
const C = 2 * Math.PI * R;

/**
 * "38k / 200k" with a thin ring, or what the chat read and wrote ("202k / 101k") when the engine reports no
 * context; toggles the Usage panel and stays pressed while it is open.
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
  const share = context?.window ? Math.min(1, context.used / context.window) : undefined;
  const label = context
    ? context.window
      ? t("composer.contextOf", { used: k(context.used), window: k(context.window) })
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
        className={`ctxchip${share != null && share > 0.8 ? " is-full" : ""}${open ? " is-open" : ""}`}
        aria-label={label}
        aria-pressed={open}
        onClick={() => go.togglePanel("usage")}
      >
        {share != null ? (
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" className="ctxchip__ring">
            <circle cx="9" cy="9" r={R} className="ctxchip__track" />
            <circle
              cx="9"
              cy="9"
              r={R}
              className="ctxchip__fill"
              strokeDasharray={`${share * C} ${C}`}
              transform="rotate(-90 9 9)"
            />
          </svg>
        ) : (
          <Icons.Zap size={12} />
        )}
        {context ? (
          <span className="ctxchip__text">
            {k(context.used)}
            {context.window ? ` / ${k(context.window)}` : ""}
          </span>
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
