import { Button, Dialog, Spinner } from "@apx/ui";
import { applyUpdate, closeUpdate, loadUpdates, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

/** The update dialog (from the pill or the corner card): what changed, and "Update now". */
export function UpdateDialog() {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const target = useUpdates((s) => s.target);
  const phase = useUpdates((s) => s.phase);
  const log = useUpdates((s) => s.log);
  const close = () => {
    if (phase === "updating" || phase === "restarting") return;
    closeUpdate();
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
