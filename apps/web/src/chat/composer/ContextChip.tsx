import { Icons } from "@apx/ui";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { tokens as k } from "./context.ts";

const R = 7;
const C = 2 * Math.PI * R;

/** "38k / 200k" with a thin ring; opens the Usage panel. Without a figure yet it is the Usage button alone. */
export function ContextChip({ context }: { context: { used: number; window?: number } | undefined }) {
  const t = useT();
  const share = context?.window ? Math.min(1, context.used / context.window) : undefined;
  const label = context
    ? context.window
      ? t("composer.contextOf", { used: k(context.used), window: k(context.window) })
      : t("composer.contextUsed", { used: k(context.used) })
    : t("panel.usage");
  return (
    <button
      type="button"
      className={`ctxchip${share != null && share > 0.8 ? " is-full" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => go.panel("usage")}
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
      {context && (
        <span className="ctxchip__text">
          {k(context.used)}
          {context.window ? ` / ${k(context.window)}` : ""}
        </span>
      )}
    </button>
  );
}
