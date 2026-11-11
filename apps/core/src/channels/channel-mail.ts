import type { ChannelAdapter, ChannelConfig, MailHistoryRequest, RestoreMail } from "./types.ts";

type MailLive = { config: ChannelConfig; adapter: ChannelAdapter; status: string; account?: string | undefined };

export function createChannelMail(live: ReadonlyMap<string, MailLive>, receive: (id: string) => RestoreMail) {
  return {
    mailboxes(): Array<{ id: string; label: string; address?: string }> {
      return [...live.values()]
        .filter((l) => l.status === "running" && l.adapter.compose)
        .map((l) => ({
          id: l.config.id,
          label: l.config.label ?? l.config.id,
          ...(l.account ? { address: l.account } : {}),
        }));
    },
    async compose(id: string, mail: { to: string[]; cc: string[]; subject: string; body: string }) {
      const l = live.get(id);
      if (!l?.adapter.compose || l.status !== "running") throw new Error(`the ${id} channel cannot send mail now`);
      return l.adapter.compose(mail);
    },
    async mailHistory(id: string, request: MailHistoryRequest) {
      const l = live.get(id);
      if (!l?.adapter.mailHistory || l.status !== "running") throw new Error(`the ${id} mailbox is not running`);
      return l.adapter.mailHistory(request, receive(id));
    },
  };
}
