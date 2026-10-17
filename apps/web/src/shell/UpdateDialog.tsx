import { Button, Dialog, Spinner } from "@apx/ui";
import { applyUpdate, closeUpdate, loadUpdates, restartApp, updatedByApp, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

/** The update dialog (from the pill or the corner card): what changed, and "Update now". */
export function UpdateDialog() {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const target = useUpdates((s) => s.target);
  const own = useUpdates((s) => s.phase);
  const log = useUpdates((s) => s.log);
  const close = () => {
    if (phase === "updating" || phase === "restarting") return;
    closeUpdate();
  };
  // Started from the app menu, the app may already be downloading it, or have it ready.
  const phase = target === "app" && own === "idle" ? (app?.ready ? "ready" : app?.downloading ? "updating" : own) : own;
  const changes = (target === "core" ? status?.changes : app?.notes) ?? [];
  const drag = target === "app" && app?.install === "drag";
  const byApp = updatedByApp(status, target);
  const lead =
    target === "both"
      ? t("update.leadBoth", { v: app?.latest ?? app?.ready ?? "", current: app?.current ?? "" })
      : target === "app"
        ? phase === "ready" || phase === "restarting"
          ? t("update.leadReady", { v: app?.ready ?? app?.latest ?? "" })
          : t(drag ? "update.leadAppDrag" : "update.leadApp", { v: app?.latest ?? "", current: app?.current ?? "" })
        : byApp
          ? t("update.leadByApp", { v: status?.latest ?? "" })
          : status?.source === "release"
            ? t("update.leadRelease", { v: status.latest ?? "" })
            : t("update.lead", { n: status?.behind ?? 0 });
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
            {byApp ? (
              <Button onClick={close}>{t("common.close")}</Button>
            ) : (
              <Button onClick={() => void applyUpdate()}>{t(drag ? "update.download" : "update.now")}</Button>
            )}
          </>
        ) : phase === "ready" ? (
          <>
            <Button variant="secondary" onClick={close}>
              {t("update.later")}
            </Button>
            <Button onClick={restartApp}>{t("update.restartNow")}</Button>
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
            phase === "updating"
              ? target === "app"
                ? "update.downloading"
                : target === "both"
                  ? "update.updatingBoth"
                  : "update.updating"
              : "update.restarting",
          )}
        </div>
      )}
      {phase === "ready" && (
        <p className="update__note">
          {t(window.apxDesktop?.platform === "win32" ? "update.readyLaterMenu" : "update.readyLater")}
        </p>
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
