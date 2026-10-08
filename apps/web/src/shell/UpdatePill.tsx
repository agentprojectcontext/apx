import { Icons } from "@apx/ui";
import { lazy, Suspense } from "react";
import { newerOf, openUpdate, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

// The dialog loads when it is first opened, not with the top bar.
const UpdateDialog = lazy(() => import("./UpdateDialog.tsx").then((m) => ({ default: m.UpdateDialog })));

/**
 * In the top bar, only when there is something: a newer panel to reload, a newer desktop app, or a newer APX for the
 * core this panel talks to (here or on a server) — its changes, and "Update now". Never a modal on its own.
 */
export function UpdatePill() {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const stale = useUpdates((s) => s.panelStale);
  if (stale)
    return (
      <button
        type="button"
        className="updatepill"
        aria-label={t("update.reload")}
        onClick={() => window.location.reload()}
      >
        <Icons.RefreshCw size={12} />
        <span className="updatepill__label">{t("update.reload")}</span>
      </button>
    );
  const newer = newerOf(status, app);
  if (!newer) return null;
  const label = newer.version
    ? t("update.pillVersion", { v: newer.version })
    : t("update.pill", { n: status?.behind ?? 0 });
  return (
    <button type="button" className="updatepill" aria-label={label} onClick={() => openUpdate(newer.target)}>
      <Icons.ArrowDown size={12} />
      <span className="updatepill__label">{label}</span>
    </button>
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
