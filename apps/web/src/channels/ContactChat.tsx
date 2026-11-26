import "../styles/screens.css";
import type { ChannelInfo, Person, Thread } from "@apx/protocol";
import { useEffect, useState } from "react";
import { useChannels } from "../data/channels.ts";
import { go, useNav } from "../shell/nav.ts";
import { ChannelConversation } from "./ChannelConversation.tsx";
import { ContactPanel } from "./ContactPanel.tsx";
import { useThreadPerson } from "./useThreadPerson.ts";

/**
 * A contact's chat opened from the Inbox: the same chat as in its channel (who answers, how far it got, reactions),
 * with their card beside it.
 */
export function ContactChat({ thread }: { thread: Thread }) {
  const channel = useChannels((s) => s.channels.find((c) => c.id === thread.channel?.id));
  const person = useThreadPerson(thread);
  if (!channel) return null;
  return <ContactPane thread={thread} person={person} channel={channel} />;
}

/** A saved contact with no chat yet, picked in their account's Inbox list: what is sent first makes their chat. */
export function ContactPick({ personId, channelId }: { personId: string; channelId: string }) {
  const channel = useChannels((s) => s.channels.find((c) => c.id === channelId));
  const person = useChannels((s) => s.persons.find((p) => p.id === personId));
  if (!channel || !person) return null;
  return <ContactPane thread={undefined} person={person} channel={channel} onOpened={go.inboxThread} />;
}

function ContactPane({
  thread,
  person,
  channel,
  onOpened,
}: {
  thread: Thread | undefined;
  person: Person | undefined;
  channel: ChannelInfo;
  onOpened?: (threadId: string) => void;
}) {
  // The card sits beside the chat on wide screens; on narrow ones it covers it, so it starts closed there.
  const [showCard, setCard] = useState(() => window.innerWidth >= 1280);
  const consulting = useNav((s) => Boolean(thread && s.panel === "agents" && s.panelParent === thread.id));
  useEffect(() => {
    if (consulting) setCard(false);
  }, [consulting]);
  const card = showCard && !consulting;
  return (
    <section className={`chan chan--single has-chat${card && person ? " has-card" : ""}`} aria-label={channel.label}>
      <ChannelConversation
        thread={thread}
        person={person}
        presence={undefined}
        channel={channel}
        card={card}
        onToggleCard={() => {
          if (consulting) go.panel(null);
          setCard((c) => !c);
        }}
        onBack={go.showList}
        {...(onOpened ? { onOpened } : {})}
      />
      {card && person && (
        <ContactPanel key={person.id} person={person} channel={channel} onClose={() => setCard(false)} />
      )}
    </section>
  );
}
