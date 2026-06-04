import { useState } from "react";
import { Button, Dialog, Field, Textarea } from "./ui";
import { useToast } from "./Toast";
import { Telegram } from "../lib/api";
import { t } from "../i18n";
import type { TelegramChannel } from "../types/daemon";

interface Props {
  channel: TelegramChannel | null;
  onClose: () => void;
}

export function TelegramSendDialog({ channel, onClose }: Props) {
  const toast = useToast();
  const [text, setText] = useState(t("admin.telegram_default_message"));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || !channel) return;
    setBusy(true);
    try {
      await Telegram.send({ text, channel: channel.name });
      toast.success("Mensaje enviado.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={!!channel}
      onClose={onClose}
      title={channel ? `${t("admin.telegram_send_test_title")} ${channel.name}` : ""}
      description={channel ? `chat_id: ${channel.chat_id || "—"}` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Enviar</Button>
        </>
      }
    >
      <Field label="Texto">
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Dialog>
  );
}
