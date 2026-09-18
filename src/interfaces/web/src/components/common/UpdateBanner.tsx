import useSWR from "swr";
import { ArrowUpCircle, X } from "lucide-react";
import { Update } from "../../lib/api";
import { STORAGE } from "../../constants";
import { useState } from "react";
import { t } from "../../i18n";

/**
 * "There is a newer APX than the one you are running."
 *
 * The CLI has said this after every command for a long time; the panel could
 * not, so anyone who lives in the browser simply never found out. Both read the
 * same 24h cache on the daemon, so they cannot disagree and npm is asked once a
 * day however many surfaces are watching.
 *
 * Silent in a git checkout. There, the running version is whatever the working
 * tree says — npm's `latest` is behind it as often as ahead — and `apx update`
 * replaces a global npm install, which is the wrong thing to do to a clone.
 *
 * Dismissal is per VERSION, not forever: deciding to skip 1.112.0 is a decision
 * about 1.112.0, and 1.113.0 deserves to be mentioned.
 */
export function UpdateBanner() {
  const { data } = useSWR("update", () => Update.get(), {
    refreshInterval: 60 * 60_000,
    revalidateOnFocus: false,
  });
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE.updateDismissed);
    } catch {
      return null;
    }
  });

  if (!data?.newer || !data.latest || data.from_git) return null;
  if (dismissed === data.latest) return null;

  const dismiss = () => {
    setDismissed(data.latest);
    try {
      localStorage.setItem(STORAGE.updateDismissed, data.latest!);
    } catch {
      /* private mode: gone for this session, which is enough */
    }
  };

  return (
    <div
      data-testid="update-banner"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-primary/8 px-4 py-2 text-sm"
    >
      <ArrowUpCircle size={16} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {t("update.available", { current: data.current, latest: data.latest })}
      </span>
      <code className="shrink-0 rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs">
        apx update
      </code>
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
