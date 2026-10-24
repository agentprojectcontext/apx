import "../styles/screens.css";
import type { Thread } from "@apx/protocol";
import { useState } from "react";
import { useChannels } from "../data/channels.ts";
import { go } from "../shell/nav.ts";
import { ChannelConversation } from "./ChannelConversation.tsx";
import { ContactPanel } from "./ContactPanel.tsx";

/**
 * A contact's chat opened from the Inbox: the same chat as in its channel (who answers, how far it got, reactions),
 * with their card beside it.
 */
export function ContactChat({ thread }: { thread: Thread }) {
  const channel = useChannels((s) => s.channels.find((c) => c.id === thread.channel?.id));
  const person = useChannels((s) => s.persons.find((p) => p.id === thread.channel?.person_id));
  // The card sits beside the chat on wide screens; on narrow ones it covers it, so it starts closed there.
  const [card, setCard] = useState(() => window.innerWidth >= 1280);
  if (!channel) return null;
  return (
    <section className={`chan chan--single has-chat${card && person ? " has-card" : ""}`} aria-label={channel.label}>
      <ChannelConversation
        thread={thread}
        person={person}
        presence={undefined}
        channel={channel}
        card={card}
        onToggleCard={() => setCard((c) => !c)}
        onBack={go.showList}
      />
      {card && person && <ContactPanel key={person.id} person={person} onClose={() => setCard(false)} />}
    </section>
  );
}
