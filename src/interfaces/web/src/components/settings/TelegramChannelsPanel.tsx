// Lists every Telegram channel with its owner, route_to_agent and pinned
// project, and lets the user add / edit / delete any of them. Pairs with
// TelegramGlobalPanel (which edits the *default* channel inline) — this one
// is the full list manager.

import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Empty, Loading } from "../ui";
import { useToast } from "../Toast";
import { useTelegramChannels, useTelegramContacts } from "../../hooks/useTelegram";
import { Telegram } from "../../lib/api";
import { TelegramChannelDialog } from "../TelegramChannelDialog";
import { TelegramSendDialog } from "../TelegramSendDialog";
import { secretSuffix } from "../../lib/secrets";
import { t } from "../../i18n";
import type { TelegramChannel } from "../../types/daemon";

export function TelegramChannelsPanel() {
  const toast = useToast();
  const { channels, isLoading, mutate } = useTelegramChannels();
  const { contacts } = useTelegramContacts();

  const [editing, setEditing] = useState<TelegramChannel | null>(null);
  const [sendTarget, setSendTarget] = useState<TelegramChannel | null>(null);

  // user_id → display name, so we can show "owner: Manu" instead of just the id.
  const nameByUserId = new Map<string, string>();
  for (const c of contacts) nameByUserId.set(String(c.user_id), c.name || `@${c.username || c.user_id}`);

  const remove = async (name: string) => {
    if (!confirm(`¿Borrar el canal ${name}?`)) return;
    try { await Telegram.channels.remove(name); toast.success("Canal eliminado."); mutate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Section
      title="Canales"
      description="Cada canal es un bot que el daemon polea. Acá podés añadir/quitar canales, cambiar el agente que contesta, el proyecto al que pertenece y su dueño."
      action={
        <Button size="sm" onClick={() => setEditing({ name: "" })}>
          <Plus size={14} /> Nuevo canal
        </Button>
      }
    >
      {isLoading && <Loading />}
      {!isLoading && channels.length === 0 && <Empty>Todavía no hay canales — agregá el primero.</Empty>}
      <ul className="space-y-2 text-sm">
        {channels.map((c) => {
          const ownerLabel = c.owner_user_id != null
            ? (nameByUserId.get(String(c.owner_user_id)) || `user_id ${c.owner_user_id}`)
            : "sin dueño (se reclama al primer DM)";
          return (
            <li key={c.name} className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <div className="flex items-center gap-2">
                  {c.project && <Badge tone="success">project = {c.project}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setSendTarget(c)}>
                    <Send size={13} /> {t("admin.telegram_send_test")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>{t("common.edit")}</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(c.name)}>{t("common.delete")}</Button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-fg">
                <span>chat_id: {c.chat_id || "—"}</span>
                <span>bot_token: {c.bot_token ? `…${secretSuffix(c.bot_token) ?? ""}` : "—"}</span>
                <span>route_to_agent: {c.route_to_agent || "default APX"}</span>
                <span>engine: {c.respond_with_engine ? "sí" : "no"}</span>
                <span className="col-span-2">dueño: {ownerLabel}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <TelegramChannelDialog
        channel={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); mutate(); }}
      />
      <TelegramSendDialog
        channel={sendTarget}
        onClose={() => setSendTarget(null)}
      />
    </Section>
  );
}
