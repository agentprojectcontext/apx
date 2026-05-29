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
    if (!draft.name?.trim()) { toast.error("name requerido"); return; }
    setBusy(true);
    try {
      const isExisting = channel && channel.name !== "";
      if (isExisting && channel?.name === draft.name) {
        await Telegram.channels.patch(channel.name, draft);
      } else {
        await Telegram.channels.upsert(draft);
      }
      toast.success("Canal guardado.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={!!channel}
      onClose={onClose}
      title={channel?.name ? `Editar canal: ${channel.name}` : "Nuevo canal de Telegram"}
      description="POST /telegram/channels (upsert) — PATCH /telegram/channels/:name (parcial)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="name (slug interno)">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={!!channel?.name} />
        </Field>
        <Field label="bot_token" hint={channel?.bot_token ? secretHint(channel.bot_token) : "Token del BotFather. Se guarda en ~/.apx/config.json."}>
          <Input
            type="password"
            value={draft.bot_token || ""}
            onChange={(e) => setDraft({ ...draft, bot_token: e.target.value })}
            placeholder={channel?.bot_token ? secretHint(channel.bot_token) : ""}
          />
        </Field>
        <Field label="chat_id">
          <Input value={draft.chat_id || ""} onChange={(e) => setDraft({ ...draft, chat_id: e.target.value })} />
        </Field>
        <Field label="project" hint="Slug o id del proyecto al que pinear este canal (opcional).">
          <Input value={draft.project || ""} onChange={(e) => setDraft({ ...draft, project: e.target.value })} />
        </Field>
        <Field label="route_to_agent" hint="Agente que contesta; vacío = super-agent APX.">
          <Input value={draft.route_to_agent || ""} onChange={(e) => setDraft({ ...draft, route_to_agent: e.target.value })} />
        </Field>
        <Switch
          checked={!!draft.respond_with_engine}
          onChange={(v) => setDraft({ ...draft, respond_with_engine: v })}
          label="Responder con engine (no echo)"
        />
      </div>
    </Dialog>
  );
}
