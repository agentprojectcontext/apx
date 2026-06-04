import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Send } from "lucide-react";
import { Section, StatusDot } from "../components/Section";
import { Badge, Button, Empty, Loading, Switch } from "../components/ui";
import { Admin, Projects, Telegram } from "../lib/api";
import { useToast } from "../components/Toast";
import { useDaemonStatus } from "../hooks/useDaemonStatus";
import { useEngines } from "../hooks/useEngines";
import { useProjects } from "../hooks/useProjects";
import { useTelegramStatus, useTelegramChannels } from "../hooks/useTelegram";
import { TelegramChannelDialog } from "../components/TelegramChannelDialog";
import { TelegramSendDialog } from "../components/TelegramSendDialog";
import { TelegramContactsPanel } from "../components/settings/TelegramContactsPanel";
import { t } from "../i18n";
import type { TelegramChannel } from "../types/daemon";

export function ApxAdminScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const { health, isUp } = useDaemonStatus();
  const { projects, isLoading: projLoading, mutate: mutateProjects } = useProjects();
  const { engines, isLoading: enginesLoading } = useEngines();
  const { status: tgStatus, mutate: mutateTgStatus } = useTelegramStatus();
  const { channels, isLoading: chanLoading, mutate: mutateChannels } = useTelegramChannels();

  const [editing, setEditing] = useState<TelegramChannel | null>(null);
  const [sendTarget, setSendTarget] = useState<TelegramChannel | null>(null);

  const reload = async () => {
    try { await Admin.reload(); toast.success(t("admin.reload_success")); }
    catch (e) { toast.error((e as Error).message); }
  };
  const toggleTelegram = async () => {
    try {
      if (tgStatus?.enabled) { await Telegram.stop(); toast.info(t("admin.telegram_polling_stopped")); }
      else { await Telegram.start(); toast.success(t("admin.telegram_polling_started")); }
      mutateTgStatus();
    } catch (e) { toast.error((e as Error).message); }
  };
  const removeChannel = async (name: string) => {
    if (!confirm(t("telegram_channels.delete_confirm", { name }))) return;
    try { await Telegram.channels.remove(name); toast.success(t("admin.telegram_channel_removed")); mutateChannels(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const removeProject = async (id: string, label: string) => {
    if (!confirm(t("admin.unregister_confirm", { label }))) return;
    try { await Projects.remove(id); toast.success(t("project.unregistered")); mutateProjects(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="screen-admin">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.title")}</h1>
          <p className="text-sm text-muted-fg">{t("admin.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={reload} title={t("daemon.reload_hint")}>{t("common.reload")} config</Button>
          <Button size="sm" variant="primary" onClick={() => navigate("/?action=add-project")}>
            <Plus size={14} /> {t("nav.project")}
          </Button>
        </div>
      </header>

      <Section title={t("daemon.version")}>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label={t("daemon.version")} value={health?.version || "—"} />
          <Stat label={t("daemon.uptime")}  value={health ? `${health.uptime_s}s` : "—"} />
          <Stat label={t("daemon.status")}  value={isUp ? t("daemon.running") : t("daemon.down")} ok={isUp} />
        </div>
      </Section>

      <Section title={t("admin.engines_title")} description={t("admin.engines_subtitle")}>
        {enginesLoading && <Loading />}
        <div className="flex flex-wrap gap-1.5">
          {engines.map((id) => <Badge key={id} tone="info">{id}</Badge>)}
        </div>
      </Section>

      <Section
        title={t("admin.telegram_title")}
        description={t("admin.telegram_subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Switch
              checked={!!tgStatus?.enabled}
              onChange={toggleTelegram}
              label={tgStatus?.enabled ? t("admin.telegram_polling_on") : t("admin.telegram_polling_off")}
            />
            <Button size="sm" onClick={() => setEditing({ name: "" })}>
              <Plus size={14} /> {t("admin.telegram_add_channel")}
            </Button>
          </div>
        }
      >
        {chanLoading && <Loading />}
        {channels.length === 0 && <Empty>{t("common.none_yet")}</Empty>}
        <ul className="space-y-2 text-sm">
          {channels.map((c) => (
            <li key={c.name} className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <div className="flex items-center gap-2">
                  {c.project && <Badge tone="success">project = {c.project}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setSendTarget(c)}>
                    <Send size={13} /> {t("admin.telegram_send_test")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>{t("common.edit")}</Button>
                  <Button size="sm" variant="destructive" onClick={() => removeChannel(c.name)}>{t("common.delete")}</Button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-fg">
                <span>chat_id: {c.chat_id || "—"}</span>
                <span>route_to_agent: {c.route_to_agent || "default APX"}</span>
                <span>engine: {c.respond_with_engine ? t("admin.engine_badge") : t("admin.engine_badge_no")}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <TelegramContactsPanel />

      <Section title={t("admin.projects_title")} description={t("admin.projects_subtitle")}>
        {projLoading && <Loading />}
        <ul className="divide-y divide-border">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="w-10 font-mono text-xs text-muted-fg">#{p.id}</span>
              <button
                type="button"
                className="flex-1 text-left hover:underline"
              onClick={() => navigate(`/p/${p.id}`)}
              >
                <span className="font-medium">{p.name || p.path.split("/").pop()}</span>
                <span className="ml-2 text-xs text-muted-fg">{p.path}</span>
              </button>
              <Badge>{(p.agents ?? 0)} {t("admin.agents_badge")}</Badge>
              {Number(p.id) !== 0 && (
                <Button size="sm" variant="destructive" onClick={() => removeProject(String(p.id), p.name || p.path)}>
                  {t("admin.unregister")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <TelegramChannelDialog
        channel={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); mutateChannels(); }}
      />
      <TelegramSendDialog
        channel={sendTarget}
        onClose={() => setSendTarget(null)}
      />
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
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
