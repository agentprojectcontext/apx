import type { ChannelInfo, Person } from "@apx/protocol";
import { Avatar, ConversationRow } from "@apx/ui";
import { AnswersLine } from "../channels/AnswererFace.tsx";
import { addressText } from "../channels/ContactRow.tsx";
import { ContactFlags, useContactFlags } from "../channels/flags.tsx";
import { PersonAvatar } from "../channels/PersonAvatar.tsx";
import { RELATION_KEY } from "../channels/people.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";

/** An account's saved contacts with no chat yet, after its chats: picking one opens a chat to write them. */
export function AccountContacts({ account, contacts }: { account: ChannelInfo; contacts: readonly Person[] }) {
  const picked = useNav((s) => (s.view === "inbox" && !s.threadId ? s.contactId : undefined));
  return contacts.map((p) => <ContactRow key={p.id} person={p} account={account} selected={p.id === picked} />);
}

function ContactRow({ person, account, selected }: { person: Person; account: ChannelInfo; selected: boolean }) {
  const t = useT();
  const agent = useData((s) => s.agents[person.agent_id ?? account.contacts_agent_id ?? account.agent_id]);
  const relation = person.relation ? t(RELATION_KEY[person.relation]) : undefined;
  const flags = useContactFlags(person, account.id);
  return (
    <div className="threadrow-wrap">
      <ConversationRow
        className="threadrow threadrow--account"
        selected={selected}
        onClick={() => go.contact(person.id)}
        avatar={
          <span className="threadavatar" style={{ width: 36, minWidth: 36, height: 36 }}>
            <PersonAvatar
              personId={person.id}
              name={person.name}
              size={32}
              className="threadavatar__person"
              fallback={<Avatar name={person.name} size={32} />}
            />
          </span>
        }
        title={person.name}
        meta={
          <span className="threadrow__line">
            <AnswersLine className="threadrow__who" lead={[relation]} agent={agent} />
            <ContactFlags flags={flags} />
          </span>
        }
        preview={
          <span className="threadrow__said">{addressText(account.type, person, account.id) ?? t("ch.noChat")}</span>
        }
      />
    </div>
  );
}
