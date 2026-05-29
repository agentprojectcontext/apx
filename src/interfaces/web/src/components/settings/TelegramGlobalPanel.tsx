import { useEffect, useState } from "react";
import { Section } from "../Section";
import { Button, Field, Input, Loading, Switch } from "../ui";
import { useToast } from "../Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { t } from "../../i18n";
import { secretSuffix } from "../../lib/secrets";

/**
 * Edits the "default" Telegram channel — the daemon stores channels as an
 * array under telegram.channels. We treat the first one named "default" (or
 * the first item) as the global default that the rest of the UI references.
 */
export function TelegramGlobalPanel() {
  const toast = useToast();
  const { config, isLoading, patch, mutate } = useGlobalConfig();
  const channels = config.telegram?.channels || [];
  const idx = Math.max(0, channels.findIndex((c) => c.name === "default"));
  const channel = channels[idx];

  const [enabled, setEnabled] = useState(true);
  const [poll, setPoll] = useState<number>(1500);
  const [respondWithEngine, setRespondWithEngine] = useState(true);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(!!config.telegram?.enabled);
    setPoll(Number(config.telegram?.poll_interval_ms || 1500));
    setRespondWithEngine(!!config.telegram?.respond_with_engine);
    setBotToken(""); // empty means "do not change"
    setChatId(channel?.chat_id || "");
  }, [config, channel?.chat_id]);

  if (isLoading) return <Loading />;

  const submit = async () => {
    setBusy(true);
    try {
      // Build a fresh channels array — only update the default slot.
      const nextChannels = channels.slice();
      const defaults = {
        name: "default",
        chat_id: chatId,
        respond_with_engine: respondWithEngine,
        ...(botToken ? { bot_token: botToken } : {}),
      };
      if (channels.length === 0) {
        nextChannels.push(defaults);
      } else {
        nextChannels[idx] = { ...channel, ...defaults };
      }
      await patch({
        "telegram.enabled": enabled,
        "telegram.poll_interval_ms": poll,
        "telegram.respond_with_engine": respondWithEngine,
        "telegram.channels": nextChannels,
      });
      toast.success(t("settings.telegram_global.saved"));
      mutate();
      setBotToken("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Section title={t("settings.telegram_global.title")} description={t("settings.telegram_global.subtitle")}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onChange={setEnabled} label={t("settings.telegram_global.enabled")} />
          <Switch checked={respondWithEngine} onChange={setRespondWithEngine} label={t("settings.telegram_global.respond_with_engine")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("settings.telegram_global.bot_token")}
            hint={channel?.bot_token
              ? `…${secretSuffix(channel.bot_token) ?? ""} (seteado — escribí para reemplazar)`
              : "Token del BotFather."}
          >
            <Input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={channel?.bot_token ? `…${secretSuffix(channel.bot_token) ?? ""} (ya seteado)` : ""}
            />
          </Field>
          <Field label={t("settings.telegram_global.chat_id")}>
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="889721252" />
          </Field>
          <Field label={t("settings.telegram_global.poll_interval")}>
            <Input type="number" value={String(poll)} onChange={(e) => setPoll(Number(e.target.value) || 1500)} />
          </Field>
        </div>
        <Button variant="primary" loading={busy} onClick={submit}>{t("common.save")}</Button>
      </div>
    </Section>
  );
}
