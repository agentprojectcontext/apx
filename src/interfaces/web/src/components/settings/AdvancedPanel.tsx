import { Section, StatusDot } from "../Section";
import { Button } from "../ui";
import { useToast } from "../Toast";
import { useDaemonStatus } from "../../hooks/useDaemonStatus";
import { Admin } from "../../lib/api";
import { t } from "../../i18n";
import { GlobalConfigEditor } from "../config/GlobalConfigEditor";

export function AdvancedPanel() {
  const toast = useToast();
  const { health, isUp } = useDaemonStatus();

  const reload = async () => {
    try { await Admin.reload(); toast.success("Config recargada."); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-6">
      <Section
        title={t("daemon.version")}
        action={<Button size="sm" onClick={reload}>{t("common.reload")}</Button>}
      >
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Info label={t("daemon.version")} value={health?.version || "—"} />
          <Info label={t("daemon.uptime")} value={health ? `${health.uptime_s}s` : "—"} />
          <Info label={t("daemon.status")} value={isUp ? t("daemon.running") : t("daemon.down")} ok={isUp} />
        </div>
      </Section>
      <GlobalConfigEditor />
    </div>
  );
}

function Info({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-fg">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-base font-medium">
        {ok !== undefined && <StatusDot ok={ok} />}
        <span>{value}</span>
      </div>
    </div>
  );
}
