// The accounts of one channel kind (two WhatsApp numbers, two Telegram bots, two mailboxes): which one the settings
// show, and adding another. Each account is a channel of its own, with its own sign-in, contacts and agent.
import type { ChannelInfo } from "@apx/protocol";
import { Button, Icons, Select, SettingRow } from "@apx/ui";
import { useEffect, useState } from "react";
import type { ChannelKind } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";

export type ChannelAccounts = {
  accounts: ChannelInfo[];
  /** The account the settings show; undefined while none is connected. */
  channel: ChannelInfo | undefined;
  /** Setting up an account: the first one, or another after "Add account". */
  connecting: boolean;
  pick(id: string): void;
  add(): void;
  cancel(): void;
};

export function useChannelAccounts(kind: ChannelKind): ChannelAccounts {
  const channels = useChannels((s) => s.channels);
  const wanted = useNav((s) => s.configAccount);
  const [selected, setSelected] = useState(wanted ?? "");
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    setSelected(wanted);
    setAdding(false);
  }, [wanted]);
  const accounts = channels.filter((c) => c.type === kind);
  const channel = accounts.find((c) => c.id === selected) ?? accounts[0];
  return {
    accounts,
    channel,
    connecting: adding || !channel,
    pick: (id) => {
      setSelected(id);
      setAdding(false);
    },
    add: () => setAdding(true),
    cancel: () => setAdding(false),
  };
}

/** How an account reads in the picker: its name, and the number, bot or address it is linked to. */
const accountName = (c: Pick<ChannelInfo, "label" | "account" | "email">): string => {
  const linked = c.account ?? c.email?.address;
  return linked && linked !== c.label ? `${c.label} · ${linked}` : c.label;
};

/** The picker over a kind's settings: which account, and "Add account". Hidden until one is connected. */
export function AccountPicker({ state }: { state: ChannelAccounts }) {
  const t = useT();
  if (!state.channel) return null;
  return (
    <SettingRow title={t("channels.account")}>
      <Select
        label={t("channels.account")}
        value={state.connecting ? "" : state.channel.id}
        placeholder={t("channels.newAccount")}
        onValueChange={(id) => id && state.pick(id)}
        options={state.accounts.map((c) => ({ value: c.id, label: accountName(c) }))}
      />
      {!state.connecting && (
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={state.add}>
          {t("channels.addAccount")}
        </Button>
      )}
    </SettingRow>
  );
}

/** Leaves the setup of another account, back to the one shown before. */
export function CancelAdding({ state }: { state: ChannelAccounts }) {
  const t = useT();
  if (!state.channel || !state.connecting) return null;
  return (
    <div>
      <Button variant="ghost" onClick={state.cancel}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
