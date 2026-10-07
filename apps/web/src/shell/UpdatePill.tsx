import { Icons } from "@apx/ui";
import { lazy, Suspense, useState } from "react";
import { chooseTarget, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

// The dialog loads when the pill is pressed, not with the top bar.
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
  const [open, setOpen] = useState(false);
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
  // The desktop app first: it carries its own core, so updating it updates both.
  const target = app?.latest ? "app" : status?.behind ? "core" : undefined;
  if (!target) return null;
  const label =
    target === "app" || status?.source === "release"
      ? t("update.pillVersion", { v: (target === "app" ? app?.latest : status?.latest) ?? "" })
      : t("update.pill", { n: status?.behind ?? 0 });
  return (
    <>
      <button
        type="button"
        className="updatepill"
        aria-label={label}
        onClick={() => {
          chooseTarget(target);
          setOpen(true);
        }}
      >
        <Icons.ArrowDown size={12} />
        <span className="updatepill__label">{label}</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <UpdateDialog onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
