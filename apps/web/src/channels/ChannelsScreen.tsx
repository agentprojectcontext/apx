import "../styles/screens.css";
import type { ChannelInfo } from "@apx/protocol";
import { AgentAvatar, Badge, Button, ContextMenu, EmptyState, IconButton, Icons, PickRow, ProjectTile } from "@apx/ui";
import { useEffect, useState } from "react";
import { SectionPage } from "../common/SectionPage.tsx";
import { loadChannels, useChannels } from "../data/channels.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { accountItems, accountLine } from "./accountMenu.tsx";
import { accountName } from "./accountName.ts";
import { agentName, answerersOf, answersLine, sentence } from "./answerers.ts";
import { ChoiceChips } from "./ChoiceChips.tsx";
import { type AccountCounts, useAccountCounts } from "./counts.ts";
import { ContactFlags, useAccountFlags } from "./flags.tsx";
import { KindIcon, KindTile } from "./KindIcon.tsx";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, isChannelKind } from "./kinds.ts";

const ALL = "all";

/** Channels: every messaging account, who answers it and what waits there; each opens its chats or its settings. */
export function ChannelsScreen() {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  const counts = useAccountCounts();
  const [filter, setFilter] = useState<string>(ALL);
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  const kinds = CHANNEL_KIND_IDS.filter((k) => channels.some((c) => c.type === k));
  const shown = filter === ALL ? channels : channels.filter((c) => c.type === filter);
  return (
    <SectionPage
      className="page--channels"
      bodyClassName="page"
      label={t("nav.channels")}
      title={t("nav.channels")}
      lead={t("chs.lead")}
      action={{ label: t("chs.new"), hint: t("section.channels.newHint"), onClick: () => go.newChannel() }}
    >
      <div className="chs">
        {kinds.length > 1 && (
          <ChoiceChips
            className="chs__filter"
            label={t("nav.channels")}
            value={kinds.includes(filter as never) ? filter : ALL}
            onChange={(v) => setFilter(v ?? ALL)}
            options={[
              { value: ALL, label: t("chs.all"), aside: channels.length, hint: t("chs.filter.all") },
              ...kinds.map((k) => ({
                value: k,
                label: t(CHANNEL_KINDS[k].name),
                icon: <KindIcon kind={k} size={13} />,
                aside: channels.filter((c) => c.type === k).length,
                hint: t("chs.filter.kind", { app: t(CHANNEL_KINDS[k].name) }),
              })),
            ]}
          />
        )}
        {ready && !channels.length ? (
          <EmptyState
            variant="dashed"
            icon={<Icons.MessageCircle />}
            title={t("chs.empty")}
            action={
              <Button leadingIcon={<Icons.Plus size={14} />} onClick={() => go.newChannel()}>
                {t("chs.new")}
              </Button>
            }
          >
            {t("chs.emptyBody")}
          </EmptyState>
        ) : (
          <>
            <ul className="chs__list">
              {shown.map((c) => (
                <AccountRow key={c.id} channel={c} counts={counts.get(c.id)} />
              ))}
            </ul>
            {channels.length > 0 && <p className="chs__hint">{t("chs.hint")}</p>}
          </>
        )}
      </div>
    </SectionPage>
  );
}

function AccountRow({ channel, counts }: { channel: ChannelInfo; counts: AccountCounts | undefined }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const { owner, contacts } = answerersOf(channel, agents);
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const waiting = counts?.waiting ?? 0;
  const unread = counts?.unread ?? 0;
  const status = channel.enabled ? channel.status : "off";
  const name = accountName(channel, t);
  const flags = useAccountFlags(channel, true);
  return (
    <ContextMenu
      items={accountItems(channel, t, waiting)}
      render={<li className={`chs__row${channel.enabled ? "" : " is-off"}`} />}
    >
      <PickRow
        className="chs__main"
        leading={
          kind ? (
            <span className="chs__tile">
              <KindTile kind={kind} size={22} />
            </span>
          ) : (
            <ProjectTile tone="info" icon={<Icons.Send />} size={36} />
          )
        }
        title={
          <span className="chs__name">
            <span className="chs__label" title={name}>
              {name}
            </span>
            {waiting > 0 && <Badge tone="warning">{t("chs.waiting", { n: waiting })}</Badge>}
          </span>
        }
        description={accountLine(channel, t)}
        onClick={() => go.channel(channel.id)}
      />
      <span className="chs__meta">
        {/* What it does for everyone on it; what it does not, dimmed. */}
        <ContactFlags className="chs__marks" flags={flags} />
        <span className="chs__agents" title={answersLine({ owner, contacts }, t)}>
          <span className="chs__agent">
            {owner && <AgentAvatar name={owner.name} blob={blobOf(owner)} size={18} animated={false} />}
            {sentence(agentName(owner, t))}
          </span>
          {contacts && (
            <span className="chs__agent">
              {contacts.agent && (
                <AgentAvatar name={contacts.agent.name} blob={blobOf(contacts.agent)} size={18} animated={false} />
              )}
              {sentence(t("chs.forContacts", { agent: agentName(contacts.agent, t) }))}
            </span>
          )}
        </span>
        <span className={`chs__status is-${status}`}>
          <span className="chs__dot" />
          {t(`tg.status.${status}`)}
        </span>
      </span>
      <span className="chs__unread">{unread > 0 && <span className="chan__unread">{unread}</span>}</span>
      <span className="chs__actions">
        {/* The row opens the account; these are the same tools as on top of its list. */}
        {kind && (
          <>
            <IconButton
              size="sm"
              label={t("chs.contactsOf", { name })}
              icon={<Icons.Users size={14} />}
              onClick={() => go.channelSettings(kind, channel.id, "contacts")}
            />
            <IconButton
              size="sm"
              label={t("chs.settings", { name })}
              icon={<Icons.Settings size={14} />}
              onClick={() => go.channelSettings(kind, channel.id)}
            />
          </>
        )}
      </span>
    </ContextMenu>
  );
}
