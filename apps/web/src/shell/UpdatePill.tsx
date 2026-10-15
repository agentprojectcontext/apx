import { Button, Dialog, Icons } from "@apx/ui";
import { lazy, Suspense, useState } from "react";
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
  const coreBehind = useUpdates((s) => s.coreBehind);
  if (coreBehind) return <CoreBehind version={coreBehind} />;
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
  const label =
    newer.target === "app" && app?.ready
      ? t("update.pillRestart", { v: app.ready })
      : newer.version
        ? t("update.pillVersion", { v: newer.version })
        : t("update.pill", { n: status?.behind ?? 0 });
  return (
    <button type="button" className="updatepill" aria-label={label} onClick={() => openUpdate(newer.target)}>
      <Icons.ArrowDown size={12} />
      <span className="updatepill__label">{label}</span>
    </button>
  );
}

/**
 * The core answering this panel still runs an older release: one a service or another app started before APX updated,
 * which keeps the old code until it starts again. Methods the panel uses may be missing until then.
 */
function CoreBehind({ version }: { version: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const app = import.meta.env.VITE_APX_VERSION;
  return (
    <>
      <button type="button" className="updatepill" aria-label={t("update.coreBehind")} onClick={() => setOpen(true)}>
        <Icons.TriangleAlert size={12} />
        <span className="updatepill__label">{t("update.coreBehind")}</span>
      </button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          title={t("update.coreBehindTitle")}
          footer={<Button onClick={() => setOpen(false)}>{t("common.close")}</Button>}
        >
          <p>{t("update.coreBehindBody", { core: version, app })}</p>
          <pre className="updatepill__cmd">apx service restart</pre>
          <p>{t("update.coreBehindHint")}</p>
        </Dialog>
      )}
    </>
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
