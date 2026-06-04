import { useEffect, useState } from "react";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useTelegramChannels } from "../../hooks/useTelegram";
import { Telegram } from "../../lib/api";
import { useProject } from "../../hooks/useProjects";
import { t } from "../../i18n";
import { secretHint } from "../../lib/secrets";
import type { TelegramChannel } from "../../types/daemon";

/**
 * Per-project Telegram override. The daemon's channel registry already
 * supports pinning a channel to a project via the `project` field; we just
 * surface the slot here. If the project has no pinned channel, all messages
 * sent from this project fall back to the global default.
 */
export function TelegramTab({ pid }: { pid: string }) {
  const toast = useToast();
  const { project } = useProject(pid);
  const { channels, isLoading, mutate } = useTelegramChannels();

  // Channel that has this project pinned.
  const projectRef = String(pid);
  const projectName = project?.name || project?.path?.split("/").pop() || projectRef;
  const channelName = `proj-${projectRef}`;
  const existing = channels.find(
    (c) => c.project === projectRef || c.project === projectName || c.name === channelName,
  );

  const [enabled, setEnabled] = useState(!!existing);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [routeAgent, setRouteAgent] = useState("");
  const [respondWithEngine, setRespondWithEngine] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing) {
      setEnabled(true);
      setBotToken("");
      setChatId(existing.chat_id || "");
      setRouteAgent(existing.route_to_agent || "");
      setRespondWithEngine(existing.respond_with_engine ?? true);
    } else {
      setEnabled(false);
      setBotToken(""); setChatId(""); setRouteAgent(""); setRespondWithEngine(true);
    }
  }, [existing?.name, existing?.chat_id, existing?.route_to_agent]);

  if (isLoading) return <Loading />;

  const save = async () => {
    setBusy(true);
    try {
      if (!enabled) {
        if (existing) {
          await Telegram.channels.remove(existing.name);
          toast.success(t("project.telegram.cleared"));
        }
        await mutate();
        return;
      }
      const body: TelegramChannel = {
        name: existing?.name || channelName,
        project: projectRef,
        chat_id: chatId,
        route_to_agent: routeAgent,
        respond_with_engine: respondWithEngine,
        // Only set bot_token if the user typed one. Empty = keep existing.
        ...(botToken ? { bot_token: botToken } : {}),
      };
      if (existing) {
        await Telegram.channels.patch(existing.name, body);
      } else {
        await Telegram.channels.upsert(body);
      }
      toast.success(t("project.telegram.saved"));
      await mutate();
      setBotToken("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Section title={t("project.telegram.title")} description={t("project.telegram.subtitle")}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onChange={setEnabled}
            label={enabled ? t("project.telegram.override_active") : t("project.telegram.use_default")}
          />
          {existing && <Badge tone="success">{t("project.telegram.channel_badge", { name: existing.name })}</Badge>}
        </div>
        {enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("project.telegram.bot_token")} hint={existing?.bot_token ? `${secretHint(existing.bot_token)} — vacío = mantener` : t("project.telegram.bot_hint_none")}>
                <Input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={existing?.bot_token ? secretHint(existing.bot_token) : ""} />
              </Field>
              <Field label={t("project.telegram.chat_id")}>
                <Input value={chatId} onChange={(e) => setChatId(e.target.value)} />
              </Field>
              <Field label={t("project.telegram.route_agent")} hint={t("project.telegram.route_hint")}>
                <Input value={routeAgent} onChange={(e) => setRouteAgent(e.target.value)} />
              </Field>
            </div>
            <Switch
              checked={respondWithEngine}
              onChange={setRespondWithEngine}
              label={t("project.telegram.respond_engine")}
            />
          </>
        )}
        <div className="pt-2">
          <Button variant="primary" loading={busy} onClick={save}>{t("common.save")}</Button>
        </div>
        {!enabled && !existing && (
          <Empty>{t("project.telegram.no_override")}</Empty>
        )}
      </div>
    </Section>
  );
}
