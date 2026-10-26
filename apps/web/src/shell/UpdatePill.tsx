import { Icons, Tooltip } from "@apx/ui";
import { Suspense } from "react";
import { useData } from "../data/state.ts";
import { newerOf, openUpdate, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";
import { CoreBehind, UpdateDialog } from "../lazy.ts";
import { go } from "./nav.ts";

/**
 * In the top bar, only when there is something: a newer panel to reload, a newer desktop app, or a newer APX for the
 * core this panel talks to (here or on a server) — its changes, and "Update now". Never a modal on its own.
 */
export function UpdatePill() {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const stale = useUpdates((s) => s.panelStale);
  const coreBehind = useUpdates((s) => s.coreBehind);
  if (coreBehind)
    return (
      <Suspense fallback={null}>
        <CoreBehind version={coreBehind} />
      </Suspense>
    );
  if (stale)
    return (
      <Tooltip content={t("update.reload")} side="bottom">
        <button
          type="button"
          className="updatepill"
          aria-label={t("update.reload")}
          onClick={() => window.location.reload()}
        >
          <Icons.RefreshCw size={12} />
          <span className="updatepill__label">{t("update.reload")}</span>
        </button>
      </Tooltip>
    );
  const newer = newerOf(status, app);
  if (!newer) return null;
  const label =
    newer.target === "app" && app?.ready
      ? t("update.pillRestart", { v: app.ready })
      : newer.version
        ? t("update.pillVersion", { v: newer.version })
        : t("update.pill", { n: status?.behind ?? 0 });
  return (
    <Tooltip content={label} side="bottom">
      <button type="button" className="updatepill" aria-label={label} onClick={() => openUpdate(newer.target)}>
        <Icons.ArrowDown size={12} />
        <span className="updatepill__label">{label}</span>
      </button>
    </Tooltip>
  );
}

/** After an update, until it is read: the chat in which the super-agent told what the new release brought. */
export function WhatsNewPill() {
  const t = useT();
  const told = useData((s) => {
    const unread = Object.values(s.threads).filter((x) => x.release && x.unread > 0 && !x.archived);
    return unread.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  });
  if (!told?.release) return null;
  return (
    <Tooltip content={t("update.whatsNewTitle", { v: told.release })} side="bottom">
      <button type="button" className="updatepill" aria-label={t("update.whatsNew")} onClick={() => go.thread(told.id)}>
        <Icons.Sparkles size={12} />
        <span className="updatepill__label">{t("update.whatsNew")}</span>
      </button>
    </Tooltip>
  );
}

/** The update dialog, wherever it was opened from. */
export function UpdateDialogHost() {
  const open = useUpdates((s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <UpdateDialog />
    </Suspense>
  );
}
