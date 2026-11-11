import type { ChannelInfo, Person } from "@apx/protocol";
import { Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { type MessageKey, useT } from "../i18n/index.ts";

/** Something set for a contact or an account, shown as a small mark with its words on hover. */
export type Flag = { key: string; icon: ReactNode; label: string };

const ACCOUNT_PERMS: Array<{ key: keyof Person["perms"]; icon: ReactNode; label: MessageKey }> = [
  { key: "appointments", icon: <Icons.Calendar size={12} />, label: "ch.acctFlag.appointments" },
  { key: "requests", icon: <Icons.ListChecks size={12} />, label: "ch.acctFlag.requests" },
  { key: "notes", icon: <Icons.BookOpen size={12} />, label: "ch.acctFlag.notes" },
];

/** What an account sets for everyone on it, as the same small marks: who it answers, when, and what its chats may do. */
export function useAccountFlags(channel: ChannelInfo | undefined): Flag[] {
  const t = useT();
  if (!channel) return [];
  const flag = (key: string, icon: ReactNode, label: MessageKey): Flag => ({ key, icon, label: t(label) });
  if (channel.owner_only) return [flag("owner_only", <Icons.Lock size={12} />, "ch.acctFlag.ownerOnly")];
  return [
    ...(channel.quiet ? [flag("quiet", <Icons.BellOff size={12} />, "ch.acctFlag.quiet")] : []),
    ...(channel.hours ? [flag("hours", <Icons.Clock size={12} />, "ch.acctFlag.hours")] : []),
    ...(channel.rules?.trim() ? [flag("rules", <Icons.FileText size={12} />, "ch.acctFlag.rules")] : []),
    ...ACCOUNT_PERMS.filter((f) => channel.contacts?.[f.key]).map((f) => flag(f.key, f.icon, f.label)),
  ];
}

export function ContactFlags({ flags, className }: { flags: Flag[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={className ? `chan__flags ${className}` : "chan__flags"}>
      {flags.map((f) => (
        <Tooltip key={f.key} content={f.label}>
          <span className="chan__flag" role="img" aria-label={f.label}>
            {f.icon}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
