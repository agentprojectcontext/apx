import type { ChannelInfo, Person } from "@apx/protocol";
import { Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { useChannels } from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

/** Something set for a contact or an account, shown as a small mark with its words on hover. */
export type Flag = { key: string; icon: ReactNode; label: string; off?: boolean };

const ACCOUNT_PERMS: Array<{ key: keyof Person["perms"]; icon: ReactNode; label: MessageKey; no: MessageKey }> = [
  {
    key: "appointments",
    icon: <Icons.Calendar size={12} />,
    label: "ch.acctFlag.appointments",
    no: "ch.acctFlag.noAppointments",
  },
  {
    key: "requests",
    icon: <Icons.ListChecks size={12} />,
    label: "ch.acctFlag.requests",
    no: "ch.acctFlag.noRequests",
  },
  { key: "notes", icon: <Icons.BookOpen size={12} />, label: "ch.acctFlag.notes", no: "ch.acctFlag.noNotes" },
];

/**
 * What an account sets for everyone on it, as the same small marks: who it answers, when, and what its chats may do.
 * `all` also shows, dimmed, what its chats may not do (where its accounts are compared side by side).
 */
export function useAccountFlags(channel: ChannelInfo | undefined, all = false): Flag[] {
  const t = useT();
  if (!channel) return [];
  const flag = (key: string, icon: ReactNode, label: MessageKey, off = false): Flag => ({
    key,
    icon,
    label: t(label),
    ...(off ? { off } : {}),
  });
  const quiet = channel.quiet ? [flag("quiet", <Icons.BellOff size={12} />, "ch.acctFlag.quiet")] : [];
  // Nobody else is answered: what their chats may do does not apply.
  if (channel.owner_only) return [flag("owner_only", <Icons.Lock size={12} />, "ch.acctFlag.ownerOnly"), ...quiet];
  return [
    ...quiet,
    ...(channel.hours ? [flag("hours", <Icons.Clock size={12} />, "ch.acctFlag.hours")] : []),
    ...(channel.rules?.trim() ? [flag("rules", <Icons.FileText size={12} />, "ch.acctFlag.rules")] : []),
    ...ACCOUNT_PERMS.flatMap((f) =>
      channel.contacts?.[f.key] ? [flag(f.key, f.icon, f.label)] : all ? [flag(f.key, f.icon, f.no, true)] : [],
    ),
  ];
}

export function ContactFlags({ flags, className }: { flags: Flag[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={className ? `chan__flags ${className}` : "chan__flags"}>
      {flags.map((f) => (
        <Tooltip key={f.key} content={f.label}>
          <span className={f.off ? "chan__flag is-off" : "chan__flag"} role="img" aria-label={f.label}>
            {f.icon}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

const PERM_FLAGS: Array<{ key: keyof Person["perms"]; icon: ReactNode; label: MessageKey }> = [
  { key: "appointments", icon: <Icons.Calendar size={12} />, label: "ch.perm.appointments" },
  { key: "requests", icon: <Icons.ListChecks size={12} />, label: "ch.perm.requests" },
  { key: "notes", icon: <Icons.BookOpen size={12} />, label: "ch.perm.notes" },
];

/** What is set for a contact, as small marks: silenced, rules of their own, and each thing their chat may do here. */
export function useContactFlags(person: Person | undefined, channelId: string): Flag[] {
  const t = useT();
  const defaults = useChannels((s) => s.channels.find((c) => c.id === channelId)?.contacts);
  if (!person) return [];
  // What their chat may do on this account: what is set for them, else what the account sets.
  const rights = { ...defaults, ...person.perms };
  return [
    // Someone who wrote first stays silenced until the owner reviews them.
    ...(person.muted
      ? [
          {
            key: "muted",
            icon: <Icons.BellOff size={12} />,
            label: t(person.unreviewed ? "ch.unreviewed" : "ch.muted"),
          },
        ]
      : []),
    ...(person.supervised ? [{ key: "supervised", icon: <Icons.Eye size={12} />, label: t("ch.supervised") }] : []),
    ...(person.rules?.trim() ? [{ key: "rules", icon: <Icons.FileText size={12} />, label: t("ch.flag.rules") }] : []),
    ...PERM_FLAGS.filter((f) => rights[f.key]).map((f) => ({ key: f.key, icon: f.icon, label: t(f.label) })),
  ];
}
