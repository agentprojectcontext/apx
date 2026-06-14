// Roster of known Telegram contacts (global, keyed by user_id) with inline
// role assignment. Used in both Settings → Telegram → Contactos and in the
// APX admin screen — shared so they can't drift apart.

import { Section } from "../Section";
import { Badge, Button, Empty, Loading, Select } from "../ui";
import { useToast } from "../Toast";
import { useTelegramContacts } from "../../hooks/useTelegram";
import { Telegram } from "../../lib/api";
import { t } from "../../i18n";
import type { TelegramContact, TelegramRole } from "../../types/daemon";

interface Props {
  /** Render bare (no Section wrapper); useful when the parent already provides one. */
  bare?: boolean;
}

export function TelegramContactsPanel({ bare = false }: Props) {
  const toast = useToast();
  const { contacts, roles, channelOwners, isLoading, mutate } = useTelegramContacts();

  const ownerIds = new Set(
    channelOwners.filter((o) => o.owner_user_id != null).map((o) => String(o.owner_user_id)),
  );
  // Built-in roles + any custom ones defined in config.
  const roleNames = Array.from(new Set(["owner", "guest", ...Object.keys(roles)]));

  const setRole = async (c: TelegramContact, role: string) => {
    try {
      await Telegram.contacts.patch(c.user_id, { role });
      toast.success(t("telegram_ui.role_assigned", { name: c.name || c.user_id, role }));
      mutate();
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (c: TelegramContact) => {
    if (!confirm(t("telegram_contacts.delete_confirm", { name: c.name || String(c.user_id) }))) return;
    try { await Telegram.contacts.remove(c.user_id); toast.success(t("telegram_contacts.removed")); mutate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const body = (
    <>
      {isLoading && <Loading />}
      {!isLoading && contacts.length === 0 && (
        <Empty>{t("telegram_contacts.empty")}</Empty>
      )}
      {contacts.length > 0 && (
        <ul className="space-y-2 text-sm">
          {contacts.map((c) => {
            const isOwner = ownerIds.has(String(c.user_id));
            const effectiveRole = isOwner ? "owner" : (c.role || "guest");
            return (
              <li key={String(c.user_id)} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{c.name || "—"}</span>
                    {c.username && <span className="ml-2 text-xs text-muted-fg">@{c.username}</span>}
                    {isOwner && <Badge tone="success">{t("telegram_contacts.owner_badge")}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={effectiveRole}
                      disabled={isOwner}
                      onChange={(e) => setRole(c, e.target.value)}
                      title={isOwner ? t("telegram_contacts.owner_hint") : t("telegram_contacts.assign_role")}
                    >
                      {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                    <Button size="sm" variant="destructive" onClick={() => remove(c)}>{t("common.delete")}</Button>
                  </div>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-fg">
                  <span>user_id: {String(c.user_id)}</span>
                  <span>{t("telegram_contacts.last_seen")} {c.last_seen ? c.last_seen.slice(0, 10) : "—"}</span>
                  <span>{roleToolsLabel(roles[effectiveRole])}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  if (bare) return body;
  return (
    <Section
      title={t("telegram_contacts.title")}
      description={t("telegram_contacts.desc")}
    >
      {body}
    </Section>
  );
}

function roleToolsLabel(role: TelegramRole | undefined): string {
  if (!role || role.tools === undefined) return "";
  if (role.tools === "*") return t("telegram_contacts.tools_all");
  if (Array.isArray(role.tools)) return role.tools.length ? `${t("telegram_contacts.tools_label")} ${role.tools.join(", ")}` : t("telegram_contacts.tools_none");
  return "";
}
