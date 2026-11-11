import type { Agent, ChannelType, Person, Thread } from "@apx/protocol";
import { Tooltip } from "@apx/ui";
import { shortWhen } from "../common/format.ts";
import type { PresenceState } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";
import { AnswersLine } from "./AnswersLine.tsx";
import { ContactFlags, useContactFlags } from "./flags.tsx";
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

export function ContactRow({
  row,
  type,
  channelId,
  presence,
  agent,
  selected,
  onPick,
}: {
  row: Row;
  type: ChannelType;
  channelId: string;
  presence: PresenceState | undefined;
  /** Who answers them here: their own agent, or the account's. */
  agent: Agent | undefined;
  selected: boolean;
  onPick(): void;
}) {
  const t = useT();
  const { thread, person } = row;
  const name = person?.name ?? thread?.title ?? "";
  const relation = person?.relation ? t(RELATION_KEY[person.relation]) : undefined;
  const unread = thread?.unread ?? 0;
  const flags = useContactFlags(person, channelId);
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
          <span className="chan__rowtop chan__rowanswer">
            <AnswersLine className="chan__rel" lead={[relation]} agent={agent} />
            <ContactFlags flags={flags} />
          </span>
        </span>
      </button>
    </li>
  );
}
