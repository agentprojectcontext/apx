import { Button, Dialog, Icons, Spinner } from "@apx/ui";
import { useState } from "react";
import { applyUpdate, chooseTarget, loadUpdates, resetUpdate, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

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
      {open && <UpdateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function UpdateDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const target = useUpdates((s) => s.target);
  const phase = useUpdates((s) => s.phase);
  const log = useUpdates((s) => s.log);
  const close = () => {
    if (phase === "updating" || phase === "restarting") return;
    resetUpdate();
    onClose();
  };
  const changes = (target === "app" ? app?.notes : status?.changes) ?? [];
  const lead =
    target === "app"
      ? t("update.leadApp", { v: app?.latest ?? "", current: app?.current ?? "" })
      : status?.source === "release"
        ? t("update.leadRelease", { v: status.latest ?? "" })
        : t("update.lead", { n: status?.behind ?? 0 });
  const drag = target === "app" && app?.install === "drag";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t("update.title")}
      description={lead}
      footer={
        phase === "idle" ? (
          <>
            <Button variant="secondary" onClick={() => void loadUpdates(true)}>
              {t("update.check")}
            </Button>
            <Button onClick={() => void applyUpdate()}>{t(drag ? "update.download" : "update.now")}</Button>
          </>
        ) : phase === "done" || phase === "failed" ? (
          <Button variant="secondary" onClick={close}>
            {t("common.close")}
          </Button>
        ) : undefined
      }
    >
      {phase === "idle" && changes.length > 0 && (
        <ul className="update__changes">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {(phase === "updating" || phase === "restarting") && (
        <div className="update__wait">
          <Spinner size={16} />
          {t(
            phase === "updating" ? (target === "app" ? "update.downloading" : "update.updating") : "update.restarting",
          )}
        </div>
      )}
      {phase === "done" && <p className="update__note">{t(drag ? "update.dragDone" : "update.done")}</p>}
      {phase === "failed" && (
        <>
          <p className="update__note">{t("update.failed")}</p>
          {log && <pre className="update__log">{log}</pre>}
        </>
      )}
    </Dialog>
  );
}
