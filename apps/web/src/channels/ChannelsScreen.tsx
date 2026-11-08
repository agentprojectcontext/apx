import "../styles/screens.css";
import type { ChannelInfo } from "@apx/protocol";
import {
  AgentAvatar,
  Badge,
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  Icons,
  PickRow,
  ProjectTile,
  SegmentedControl,
} from "@apx/ui";
import { useEffect, useState } from "react";
import { loadChannels, useChannels } from "../data/channels.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { accountItems, accountLine } from "./accountMenu.tsx";
import { type AccountCounts, useAccountCounts } from "./counts.ts";
import { KindTile } from "./KindIcon.tsx";
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
    <section className="page page--channels" aria-label={t("nav.channels")}>
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">{t("nav.channels")}</h1>
          <p className="page__lead">{t("chs.lead")}</p>
        </div>
        <Button leadingIcon={<Icons.Plus size={14} />} onClick={() => go.newChannel()}>
          {t("chs.new")}
        </Button>
      </header>
      <div className="chs">
        {kinds.length > 1 && (
          <SegmentedControl
            size="sm"
            className="chs__filter"
            label={t("nav.channels")}
            value={kinds.includes(filter as never) ? filter : ALL}
            onValueChange={setFilter}
            options={[
              { value: ALL, label: `${t("chs.all")} ${channels.length}` },
              ...kinds.map((k) => ({
                value: k,
                label: `${t(CHANNEL_KINDS[k].name)} ${channels.filter((c) => c.type === k).length}`,
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
    </section>
  );
}

function AccountRow({ channel, counts }: { channel: ChannelInfo; counts: AccountCounts | undefined }) {
  const t = useT();
  const agent = useData((s) => s.agents[channel.agent_id]);
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const waiting = counts?.waiting ?? 0;
  const unread = counts?.unread ?? 0;
  const status = channel.enabled ? channel.status : "off";
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
            {channel.label}
            {waiting > 0 && <Badge tone="warning">{t("chs.waiting", { n: waiting })}</Badge>}
          </span>
        }
        description={accountLine(channel, t)}
        onClick={() => go.channel(channel.id)}
      />
      <span className="chs__meta">
        <span className="chs__agent">
          {agent && <AgentAvatar name={agent.name} blob={blobOf(agent)} size={18} animated={false} />}
          {agent?.name ?? channel.agent_id}
        </span>
        <span className={`chs__status is-${status}`}>
          <span className="chs__dot" />
          {t(`tg.status.${status}`)}
        </span>
      </span>
      <span className="chs__unread">{unread > 0 && <span className="chan__unread">{unread}</span>}</span>
      <span className="chs__actions">
        <Button size="sm" variant="secondary" onClick={() => go.channel(channel.id)}>
          {t("chs.open")}
        </Button>
        {kind && (
          <IconButton
            size="sm"
            label={t("chs.settings", { name: channel.label })}
            icon={<Icons.Pencil size={14} />}
            onClick={() => go.channelSettings(kind, channel.id)}
          />
        )}
      </span>
    </ContextMenu>
  );
}
