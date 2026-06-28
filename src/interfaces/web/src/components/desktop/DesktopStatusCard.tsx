import { useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { Settings } from "lucide-react";
import { Section, Kbd, StatusDot } from "../Section";
import { Button, Loading } from "../ui";
import { useToast } from "../Toast";
import { Desktop } from "../../lib/api/desktop";
import { t } from "../../i18n";

// Live status of the floating Desktop window + lifecycle controls
// (start/stop/restart). Shared between the Desktop rail module and the
// Settings → Desktop panel so both surfaces keep the same action card.
// Pass `showConfigLink` on the rail module to link into the settings panel;
// inside Settings it's redundant, so it's omitted there.
export function DesktopStatusCard({ showConfigLink = false }: { showConfigLink?: boolean }) {
  const toast = useToast();

  const { data: status, isLoading: stLoading, mutate: mutateStatus } = useSWR(
    "/desktop/status",
    () => Desktop.status(),
    { refreshInterval: 5000 },
  );
  const running = !!status?.running;

  // Which lifecycle action (start/stop/restart) is in flight — drives the
  // per-button spinner and disables its siblings while one runs.
  const [lifeAction, setLifeAction] = useState<"start" | "stop" | "restart" | null>(null);

  // Start/Stop launch or kill the Electron window (daemon spawns/SIGTERMs it);
  // Restart tells a live window to reload + re-read config (theme, position,
  // shortcut) — the "apply now" the static status-poll never did. All three
  // re-poll status shortly after so the dot + buttons settle.
  const runLifecycle = async (action: "start" | "stop" | "restart", fn: () => Promise<void>) => {
    setLifeAction(action);
    try { await fn(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLifeAction(null); setTimeout(() => mutateStatus(), 1200); }
  };
  const startDesktop = () => runLifecycle("start", async () => {
    const r = await Desktop.start();
    toast.success(r.already ? t("modules_ui.desktop_start_already") : t("modules_ui.desktop_start_done"));
  });
  const stopDesktop = () => runLifecycle("stop", async () => {
    const r = await Desktop.stop();
    toast.success(r.stopped ? t("modules_ui.desktop_stop_done") : t("modules_ui.desktop_stop_none"));
  });
  const restartDesktop = () => runLifecycle("restart", async () => {
    const r = await Desktop.restart();
    if (r.reloaded > 0) toast.success(t("modules_ui.desktop_restart_done"));
    else toast.info(t("modules_ui.desktop_restart_none"));
  });

  return (
    <Section
      title={t("desktop_screen.status_title")}
      description={t("modules_ui.desktop_status_desc")}
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={startDesktop}
            loading={lifeAction === "start"}
            disabled={running || (lifeAction !== null && lifeAction !== "start")}
          >
            {t("modules_ui.desktop_start")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={stopDesktop}
            loading={lifeAction === "stop"}
            disabled={!running || (lifeAction !== null && lifeAction !== "stop")}
          >
            {t("modules_ui.desktop_stop")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={restartDesktop}
            loading={lifeAction === "restart"}
            disabled={!running || (lifeAction !== null && lifeAction !== "restart")}
            title={t("modules_ui.desktop_restart_hint")}
          >
            {t("modules_ui.desktop_restart")}
          </Button>
          {showConfigLink && (
            <Link to="/settings/desktop">
              <Button size="sm" variant="ghost">
                <Settings size={14} /> {t("desktop_screen.open_config")}
              </Button>
            </Link>
          )}
        </div>
      }
    >
      {stLoading ? <Loading /> : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <StatusDot ok={running} />
          <span className="font-medium">{running ? t("modules_ui.desktop_running") : t("modules_ui.desktop_stopped")}</span>
          <button
            type="button"
            onClick={() => mutateStatus()}
            className="text-xs text-muted-fg underline-offset-2 hover:underline"
          >
            {t("modules_ui.desktop_refresh")}
          </button>
          <span className="text-xs text-muted-fg">
            ({t("modules_ui.desktop_from_terminal")} <Kbd>apx desktop start</Kbd> · <Kbd>apx desktop --debug</Kbd>)
          </span>
        </div>
      )}
    </Section>
  );
}
