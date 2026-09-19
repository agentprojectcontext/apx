import useSWR from "swr";
import { ArrowUpCircle, Check, Copy, X } from "lucide-react";
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
const CMD = "apx update";

export function UpdateBanner() {
  const { data } = useSWR("update", () => Update.get(), {
    refreshInterval: 60 * 60_000,
    revalidateOnFocus: false,
  });
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE.updateDismissed);
    } catch {
      return null;
    }
  });

  if (!data?.newer || !data.latest || data.from_git) return null;
  if (dismissed === data.latest) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard without a secure context. Selecting it by hand still
      // works, so this fails quietly rather than claiming it copied.
    }
  };

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
      className="flex items-start gap-3 rounded-2xl border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12">
        <ArrowUpCircle size={18} className="text-primary" />
      </span>

      {/* The shape the CLI has printed for a long time — "1.111.0 → 1.112.0",
          the fact and nothing else. It used to announce itself ("APX 1.112.0 is
          out"), which reads like marketing for something you already have. */}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("update.available")}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-fg">
          {data.current} → {data.latest}
        </p>
        {/* Copy, and nothing more ambitious. A page cannot open a terminal —
            there is no scheme for it that works across machines — and the
            daemon must not run this itself: `apx update` stops the daemon as
            its first step, so anything asking for it from inside is asking the
            process to kill the turn that asked. */}
        <button
          type="button"
          onClick={copy}
          title={t("update.copy")}
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1 font-mono text-xs transition-colors hover:bg-muted"
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} className="text-muted-fg" />}
          apx update
        </button>
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
