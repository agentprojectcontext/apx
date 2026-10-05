import { Button, Dialog, Icons, Spinner } from "@apx/ui";
import { useState } from "react";
import { applyUpdate, loadUpdates, resetUpdate, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

/**
 * In the top bar, only when there is something: a newer panel to reload, or a newer APX to bring in (its changes, and
 * "Update now"). Never a modal on its own.
 */
export function UpdatePill() {
  const t = useT();
  const status = useUpdates((s) => s.status);
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
  if (!status?.behind) return null;
  return (
    <>
      <button
        type="button"
        className="updatepill"
        aria-label={t("update.pill", { n: status.behind })}
        onClick={() => setOpen(true)}
      >
        <Icons.ArrowDown size={12} />
        <span className="updatepill__label">{t("update.pill", { n: status.behind })}</span>
      </button>
      {open && <UpdateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function UpdateDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const phase = useUpdates((s) => s.phase);
  const log = useUpdates((s) => s.log);
  const close = () => {
    if (phase === "updating" || phase === "restarting") return;
    resetUpdate();
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t("update.title")}
      description={t("update.lead", { n: status?.behind ?? 0 })}
      footer={
        phase === "idle" ? (
          <>
            <Button variant="secondary" onClick={() => void loadUpdates(true)}>
              {t("update.check")}
            </Button>
            <Button onClick={() => void applyUpdate()}>{t("update.now")}</Button>
          </>
        ) : phase === "done" || phase === "failed" ? (
          <Button variant="secondary" onClick={close}>
            {t("common.close")}
          </Button>
        ) : undefined
      }
    >
      {phase === "idle" && (
        <ul className="update__changes">
          {(status?.changes ?? []).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {(phase === "updating" || phase === "restarting") && (
        <div className="update__wait">
          <Spinner size={16} />
          {t(phase === "updating" ? "update.updating" : "update.restarting")}
        </div>
      )}
      {phase === "done" && <p className="update__note">{t("update.done")}</p>}
      {phase === "failed" && (
        <>
          <p className="update__note">{t("update.failed")}</p>
          <pre className="update__log">{log}</pre>
        </>
      )}
    </Dialog>
  );
}
