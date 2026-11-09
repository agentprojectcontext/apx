import { Button, Icons, Input, SettingRow } from "@apx/ui";
import type { ChannelDraft } from "../../data/channels.ts";
import { useT } from "../../i18n/index.ts";
import type { ChannelKind } from "../kinds.ts";
import { BotAccount, BotConnect, isBotKind } from "./BotAccount.tsx";
import { EmailAccount, EmailConnect } from "./EmailAccount.tsx";
import { IMessageAccount, IMessageConnect } from "./IMessageAccount.tsx";
import type { Create, PaneProps } from "./types.ts";
import { WhatsAppAccount, WhatsAppConnect } from "./WhatsAppAccount.tsx";

/** The account's name in the sidebar and the lists. */
function NameRow({ value, set }: { value: string; set(patch: Partial<ChannelDraft>): void }) {
  const t = useT();
  return (
    <SettingRow title={t("ch.accountName")} description={t("ch.accountNameHint")}>
      <Input
        size="sm"
        aria-label={t("ch.accountName")}
        placeholder={t("acct.namePlaceholder")}
        value={value}
        maxLength={60}
        onChange={(e) => set({ label: e.currentTarget.value })}
      />
    </SettingRow>
  );
}

/** A new account: its name, and how to connect it (a QR, a bot's token, a mailbox). */
export function NewAccountPane({
  kind,
  label,
  set,
  create,
}: {
  kind: ChannelKind;
  label: string;
  set(patch: Partial<ChannelDraft>): void;
  create: Create;
}) {
  const t = useT();
  return (
    <>
      {kind !== "imessage" && <NameRow value={label} set={set} />}
      <div className="acct__sub">{t("acct.connect")}</div>
      {kind === "whatsapp" ? (
        <WhatsAppConnect create={create} />
      ) : kind === "email" ? (
        <EmailConnect create={create} />
      ) : kind === "imessage" ? (
        <IMessageConnect create={create} />
      ) : isBotKind(kind) ? (
        <BotConnect kind={kind} create={create} />
      ) : null}
    </>
  );
}

/** An account's connection and its name; disconnecting it removes its sign-in. */
export function AccountPane({ kind, onRemove, ...pane }: PaneProps & { kind: ChannelKind; onRemove(): void }) {
  const t = useT();
  return (
    <>
      <NameRow value={pane.draft.label ?? ""} set={pane.set} />
      {kind === "whatsapp" ? (
        <WhatsAppAccount {...pane} />
      ) : kind === "email" ? (
        <EmailAccount {...pane} />
      ) : kind === "imessage" ? (
        <IMessageAccount {...pane} />
      ) : isBotKind(kind) ? (
        <BotAccount kind={kind} {...pane} />
      ) : null}
      <div className="tgremove">
        <Button
          size="sm"
          variant="ghost"
          className="acct__danger"
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={onRemove}
        >
          {t("acct.disconnect")}
        </Button>
      </div>
    </>
  );
}
