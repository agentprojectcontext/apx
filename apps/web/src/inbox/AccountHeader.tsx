import "../styles/inbox-parts.css";
import type { ChannelInfo } from "@apx/protocol";
import { Button, IconButton, Icons, PickRow, Popover } from "@apx/ui";
import { useState } from "react";
import { AnswersLine } from "../channels/AnswererFace.tsx";
import { accountName, accountWhere } from "../channels/accountName.ts";
import { useAccountCounts } from "../channels/counts.ts";
import { ContactFlags, useAccountFlags } from "../channels/flags.tsx";
import { KindTile } from "../channels/KindIcon.tsx";
import { isChannelKind, isRoomsKind, roomsOpenKey } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { clearFilter } from "./inboxFilter.ts";
import { openAccount } from "./openAccount.ts";

/**
 * The Inbox narrowed to one channel account: the account takes the title, and picking it switches to another account
 * (or back to every chat); beside it, the account's contacts and its settings.
 */
export function AccountHeader({ account }: { account: ChannelInfo }) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const agents = useData((s) => s.agents);
  const counts = useAccountCounts();
  const [open, setOpen] = useState(false);
  const kind = isChannelKind(account.type) ? account.type : undefined;
  const name = (c: ChannelInfo) => accountName(c, t);
  const answerer = (c: ChannelInfo) => agents[c.contacts_agent_id ?? c.agent_id];
  const flags = useAccountFlags(account);
  const pick = (f: () => void) => {
    setOpen(false);
    f();
  };
  return (
    <div className="inbox__account">
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={290}
        label={t("inbox.account.list")}
        className="accountswitch"
        trigger={
          <Button variant="ghost" className="inbox__accountbtn" aria-expanded={open}>
            <Logo channel={account} size={26} />
            <span className="inbox__accounttext">
              <span className="inbox__accountname">
                <span className="inbox__accountlabel">{name(account)}</span>
                <span className="inbox__accountchev">
                  <Icons.ChevronDown size={14} />
                </span>
              </span>
              <span className="inbox__accountsub">
                <AnswersLine
                  className="inbox__accountsubtext"
                  lead={[accountWhere(account, name(account))]}
                  agent={answerer(account)}
                />
                <ContactFlags flags={flags} />
              </span>
            </span>
          </Button>
        }
      >
        <div className="accountswitch__label">{t("inbox.account.list")}</div>
        {channels.map((c) => {
          const unread = counts.get(c.id)?.unread ?? 0;
          return (
            <PickRow
              key={c.id}
              className="accountswitch__row"
              selected={c.id === account.id}
              leading={<Logo channel={c} size={20} />}
              title={name(c)}
              description={<AnswersLine lead={[accountWhere(c, name(c))]} agent={answerer(c)} />}
              trailing={unread > 0 ? <span className="accountswitch__unread">{unread}</span> : undefined}
              onClick={() => pick(() => openAccount(c.id))}
            />
          );
        })}
        <div className="accountswitch__sep" />
        <PickRow
          className="accountswitch__foot"
          leading={<Icons.Inbox size={14} />}
          title={t("inbox.account.allChats")}
          onClick={() => pick(clearFilter)}
        />
        <PickRow
          className="accountswitch__foot"
          leading={<Icons.LayoutGrid size={14} />}
          title={t("nav.manageChannels")}
          onClick={() =>
            pick(() => {
              clearFilter();
              go.view("channels");
            })
          }
        />
      </Popover>
      {kind && (
        <>
          {isRoomsKind(kind) && (
            <IconButton
              label={t(roomsOpenKey(kind))}
              icon={<Icons.Hash size={14} />}
              onClick={() => go.channelSettings(kind, account.id, "rooms")}
            />
          )}
          <IconButton
            label={t("chs.contacts")}
            icon={<Icons.Users size={14} />}
            onClick={() => go.channelSettings(kind, account.id, "contacts")}
          />
          <IconButton
            label={t("inbox.account.edit")}
            icon={<Icons.Settings size={14} />}
            onClick={() => go.channelSettings(kind, account.id, "account")}
          />
        </>
      )}
    </div>
  );
}

function Logo({ channel, size }: { channel: ChannelInfo; size: number }) {
  return isChannelKind(channel.type) ? <KindTile kind={channel.type} size={size} /> : <Icons.Send size={size - 6} />;
}
