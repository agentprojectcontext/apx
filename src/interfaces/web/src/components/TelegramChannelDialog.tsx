import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Switch } from "./ui";
import { useToast } from "./Toast";
import { Telegram } from "../lib/api";
import { t } from "../i18n";
import { secretHint } from "../lib/secrets";
import type { TelegramChannel } from "../types/daemon";

interface Props {
  channel: TelegramChannel | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TelegramChannelDialog({ channel, onClose, onSaved }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<TelegramChannel>({ name: "" });

  useEffect(() => {
    if (channel) setDraft({ ...channel, bot_token: "" });
    else setDraft({ name: "" });
  }, [channel?.name]);

  const submit = async () => {
    if (!draft.name?.trim()) { toast.error(t("telegram_channel_dialog.name_required")); return; }
    setBusy(true);
    try {
      const isExisting = channel && channel.name !== "";
      if (isExisting && channel?.name === draft.name) {
        await Telegram.channels.patch(channel.name, draft);
      } else {
        await Telegram.channels.upsert(draft);
      }
      toast.success(t("telegram_channel_dialog.saved"));
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={!!channel}
      onClose={onClose}
      title={channel?.name ? t("telegram_channel_dialog.edit_title", { name: channel.name }) : t("telegram_channel_dialog.new_title")}
      description={t("telegram_ui.channel_dialog_desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("telegram_channel_dialog.name_label")}>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={!!channel?.name} />
        </Field>
        <Field label={t("telegram_channel_dialog.token_label")} hint={channel?.bot_token ? secretHint(channel.bot_token) : t("telegram_ui.bot_token_hint")}>
          <Input
            type="password"
            value={draft.bot_token || ""}
            onChange={(e) => setDraft({ ...draft, bot_token: e.target.value })}
            placeholder={channel?.bot_token ? secretHint(channel.bot_token) : ""}
          />
        </Field>
        <Field label={t("telegram_channel_dialog.chat_id")}>
          <Input value={draft.chat_id || ""} onChange={(e) => setDraft({ ...draft, chat_id: e.target.value })} />
        </Field>
        <Field label={t("telegram_channel_dialog.project_label")} hint={t("telegram_channel_dialog.project_hint")}>
          <Input value={draft.project || ""} onChange={(e) => setDraft({ ...draft, project: e.target.value })} />
        </Field>
        <Field label={t("telegram_channel_dialog.route_label")} hint={t("telegram_channel_dialog.route_hint")}>
          <Input value={draft.route_to_agent || ""} onChange={(e) => setDraft({ ...draft, route_to_agent: e.target.value })} />
        </Field>
        <Field
          label={t("telegram_channel_dialog.owner_label")}
          hint={t("telegram_channel_dialog.owner_hint")}
        >
          <Input
            value={draft.owner_user_id != null ? String(draft.owner_user_id) : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              setDraft({ ...draft, owner_user_id: raw === "" ? undefined : /^\d+$/.test(raw) ? Number(raw) : raw });
            }}
            placeholder="889721252"
          />
        </Field>
        <Switch
          checked={!!draft.respond_with_engine}
          onChange={(v) => setDraft({ ...draft, respond_with_engine: v })}
          label={t("telegram_channel_dialog.respond_label")}
        />
      </div>
    </Dialog>
  );
}
