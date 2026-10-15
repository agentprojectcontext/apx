import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Tip } from "../ui/tip";
import { LINKS, STORAGE } from "../../constants";
import { getLocale, t } from "../../i18n";

/**
 * The invitation to the APX v2 beta: a chip in the top bar that stays, and a card
 * (a strip on the phone) that says it once.
 *
 * The chip is the way back after the card is closed, so it is never dismissed.
 * The card follows the Discord one: closed per device, never asked again.
 */
function v2Site() {
  return getLocale() === "es" ? LINKS.v2SiteEs : LINKS.v2Site;
}

export function TryV2Chip() {
  return (
    <Tip content={t("try_v2.desc")}>
      <a
        href={v2Site()}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="try-v2"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
      >
        <Sparkles size={12} />
        {/* The short label on a narrow bar: the breadcrumb beside it already truncates. */}
        <span className="sm:hidden">{t("try_v2.chip_short")}</span>
        <span className="hidden sm:inline">{t("try_v2.chip")}</span>
      </a>
    </Tip>
  );
}

export function TryV2Card({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE.v2Dismissed) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(STORAGE.v2Dismissed, "1");
    } catch {
      /* private mode: gone for this session, which is enough */
    }
  };

  if (variant === "inline") {
    return (
      <div
        data-testid="try-v2-card"
        className="flex shrink-0 items-center gap-3 border-b border-border bg-primary/8 px-4 py-3 text-sm"
      >
        <Sparkles size={16} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t("try_v2.title")}</span>
        <a
          href={v2Site()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-fg"
        >
          {t("try_v2.cta")}
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.close")}
          className="shrink-0 rounded p-1 text-muted-fg hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="try-v2-card"
      className="flex items-start gap-3 rounded-2xl border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12">
        <Sparkles size={18} className="text-primary" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("try_v2.title")}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-fg">{t("try_v2.desc")}</p>
        <a
          href={v2Site()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          <Sparkles size={14} />
          {t("try_v2.cta")}
        </a>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="-mr-1 shrink-0 rounded p-1 text-muted-fg hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
