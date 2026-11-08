import type { ChannelInfo } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";
import { KindIcon } from "./KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "./kinds.ts";

/**
 * The card beside a channel chat (a contact's, a group's or a room's): its title and close, who or what it is on top
 * (picture, name, and the app and account it is on), the settings, and its actions at the foot.
 */
export function ChatCard({
  title,
  channel,
  name,
  avatar,
  onClose,
  footer,
  children,
}: {
  title: string;
  channel: ChannelInfo;
  name: string;
  avatar: ReactNode;
  onClose(): void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const app = kind ? t(CHANNEL_KINDS[kind].name) : channel.type;
  return (
    <aside className="chan__card" aria-label={title}>
      <header className="chan__cardhead">
        <span>{title}</span>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <div className="chan__cardbody">
        <div className="chan__cardwho">
          {avatar}
          <span className="chan__cardwhomain">
            <span className="chan__cardname">{name}</span>
            <span className="chan__cardvia">
              {kind ? <KindIcon kind={kind} size={12} /> : <Icons.Send size={12} />}
              <span>{t("ch.card.via", { app, account: channel.label })}</span>
            </span>
          </span>
        </div>
        {children}
      </div>
      <footer className="chan__cardfoot">{footer}</footer>
    </aside>
  );
}

/** A labelled part of the card: a few words over the control they name. */
export function CardField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="pform__field">
      <span className="pform__label">{label}</span>
      {children}
      {hint && <span className="pform__hint">{hint}</span>}
    </div>
  );
}
