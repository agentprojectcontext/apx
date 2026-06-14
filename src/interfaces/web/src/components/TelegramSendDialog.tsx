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
      toast.success(t("telegram_ui.message_sent"));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={!!channel}
      onClose={onClose}
      title={channel ? t("telegram_send_dialog.title", { name: channel.name }) : ""}
      description={channel ? t("telegram_ui.send_chat_id", { id: channel.chat_id || "—" }) : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("chat_ui.send")}</Button>
        </>
      }
    >
      <Field label={t("telegram_ui.message_label")}>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Dialog>
  );
}
