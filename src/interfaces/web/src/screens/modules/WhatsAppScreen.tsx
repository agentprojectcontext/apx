import { useMemo } from "react";
import useSWR from "swr";
import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { Section } from "../../components/Section";
import { Empty, Loading } from "../../components/ui";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { WhatsAppSettingsTabs } from "../../components/settings/WhatsAppSettingsTabs";
import { Inbox, type InboxRow } from "../../lib/api/inbox";
import { t } from "../../i18n";

// WhatsApp module — the same panel Settings → WhatsApp has, one click from the
// rail instead of three.
//
// Not a copy of it: the SAME component. The reason it earns a rail entry rather
// than staying a settings page is what it is used FOR. Settings is where you go
// once, to configure something; this is a roster of people who write to you all
// day, a sticker lexicon that grows, and a decision ("do we answer them?") that
// has to be made while somebody is waiting. That is a place you visit, not a
// page you set up — and the conversations are listed here too, so opening the
// module answers "who wrote?" as well as "who is this?".
export function WhatsAppScreen() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6" data-testid="screen-whatsapp">
      <WhatsAppConversations />
      <WhatsAppSettingsTabs />
    </div>
  );
}

/**
 * The WhatsApp conversations, and only those.
 *
 * The Chats sidebar and the inbox both hold these already, mixed in with every
 * other channel — which is right there and wrong here: on the WhatsApp page the
 * question is "who wrote on WhatsApp", and scrolling past Telegram threads to
 * answer it is the thing this saves. Each row opens the real thread in the
 * inbox, so there is one conversation view, not two.
 */
function WhatsAppConversations() {
  // The FULL list, filtered here — not `?channel=whatsapp`, which looks like
  // the right call and is not: passing a channel switches the endpoint to one
  // row per agent instead of one row per person (`perChannel: !channel`), so
  // four conversations collapse into a single "super-agent on WhatsApp" row.
  // The unscoped list is the one that keeps Magui, Carlos and a company apart.
  const { data, isLoading } = useSWR("/api/inbox", () => Inbox.list());
  const rows = useMemo(
    () => (data || []).filter((r: InboxRow) => r.channel === "whatsapp"),
    [data],
  );

  if (isLoading) return <Loading />;

  return (
    <Section title={t("nav.modules.whatsapp_chats")} description={t("settings.whatsapp.chats_hint")}>
      {rows.length === 0 ? (
        <Empty>{t("settings.whatsapp.no_chats")}</Empty>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <Link
              key={`${r.channel}:${r.conversation_id}:${r.contact_person ?? ""}`}
              to={`/inbox?channel=whatsapp&thread=${encodeURIComponent(r.conversation_id || "")}`}
              className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
            >
              {r.contact_face ? (
                <AgentAvatar
                  icon={r.contact_face.icon}
                  emoji={r.contact_face.emoji}
                  name={r.contact_face.name}
                  size={28}
                />
              ) : (
                <MessageSquare size={16} className="text-muted-foreground" />
              )}
              <span className="shrink-0 text-sm font-medium">{r.agent_name}</span>
              <span className="truncate text-sm text-muted-foreground">{r.preview}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {r.last_activity_at ? new Date(r.last_activity_at).toLocaleString() : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}
