import type { ChannelType, Person, Thread } from "@apx/protocol";
import { Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { shortWhen } from "../common/format.ts";
import type { PresenceState } from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { PersonAvatar } from "./PersonAvatar.tsx";
import { initials, RELATION_KEY } from "./people.ts";

/** A contact on the list: their chat when they have one, else only them (a saved contact nobody wrote to yet). */
export type Row = { key: string; thread?: Thread | undefined; person?: Person | undefined };

/** Where to reach someone, as people write it: a WhatsApp number; other channels' ids mean nothing to read. */
export function addressText(type: ChannelType, person: Person | undefined, channelId: string): string | undefined {
  const a = person?.addresses.find((x) => x.channel === channelId);
  if (!a || type !== "whatsapp") return undefined;
  const digits = a.external_id.split("@")[0] ?? "";
  return /^\d+$/.test(digits) ? `+${digits}` : undefined;
}

/** Their face, with a dot while the channel says they are online. */
export function ContactFace({
  person,
  name,
  presence,
}: {
  person: Person | undefined;
  name: string;
  presence?: PresenceState | undefined;
}) {
  const t = useT();
  return (
    <span className="chan__face">
      <PersonAvatar personId={person?.id} name={name} fallback={initials(name)} />
      {presence?.online && (
        <Tooltip content={t("ch.online")}>
          <span className="chan__presence" role="img" aria-label={t("ch.online")} />
        </Tooltip>
      )}
    </span>
  );
}

const PERM_FLAGS: Array<{ key: keyof Person["perms"]; icon: ReactNode; label: MessageKey }> = [
  { key: "appointments", icon: <Icons.Calendar size={12} />, label: "ch.perm.appointments" },
  { key: "requests", icon: <Icons.ListChecks size={12} />, label: "ch.perm.requests" },
  { key: "notes", icon: <Icons.BookOpen size={12} />, label: "ch.perm.notes" },
];

const hasFlags = (p: Person | undefined) =>
  Boolean(p && (p.muted || p.supervised || p.rules?.trim() || Object.values(p.perms).some(Boolean)));

/** What is set for a contact, as small marks: silenced, rules of their own, and each thing their chat may do. */
export function ContactFlags({ person }: { person: Person | undefined }) {
  const t = useT();
  if (!person || !hasFlags(person)) return null;
  const flags = [
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
    ...PERM_FLAGS.filter((f) => person.perms[f.key]).map((f) => ({ key: f.key, icon: f.icon, label: t(f.label) })),
  ];
  return (
    <span className="chan__flags">
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

export function ContactRow({
  row,
  type,
  channelId,
  presence,
  selected,
  onPick,
}: {
  row: Row;
  type: ChannelType;
  channelId: string;
  presence: PresenceState | undefined;
  selected: boolean;
  onPick(): void;
}) {
  const t = useT();
  const { thread, person } = row;
  const name = person?.name ?? thread?.title ?? "";
  const relation = person?.relation ? t(RELATION_KEY[person.relation]) : undefined;
  const unread = thread?.unread ?? 0;
  return (
    <li>
      <button
        type="button"
        className={`chan__row${selected ? " is-selected" : ""}${person?.muted ? " is-muted" : ""}${unread ? " is-unread" : ""}`}
        aria-current={selected || undefined}
        onClick={onPick}
      >
        <ContactFace person={person} name={name} presence={presence} />
        <span className="chan__rowmain">
          <span className="chan__rowtop">
            <span className="chan__rowname">{name}</span>
            {thread && <span className="chan__rowtime">{shortWhen(thread.updated_at)}</span>}
          </span>
          <span className="chan__rowtop">
            <span className="chan__preview">
              {thread ? thread.preview : (addressText(type, person, channelId) ?? t("ch.noChat"))}
            </span>
            {unread > 0 && <span className="chan__unread">{unread}</span>}
          </span>
          {(relation || hasFlags(person)) && (
            <span className="chan__rowtop">
              <span className="chan__rel">{relation}</span>
              <ContactFlags person={person} />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
