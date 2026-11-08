import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a channel: a channel can have an agent of its own for its contacts and rooms.
export const CHANNEL_CONTACTS_AGENT_NEWS: NewsEntry = {
  id: "channel-contacts-agent",
  since: "2.14.0",
  title: {
    en: "A channel can have its own contacts agent",
    es: "Un canal puede tener su propio agente para contactos",
  },
  about: {
    en:
      "A channel can now have an agent for its contacts and rooms, separate from the one you talk to. Chats already " +
      "open move to it when you save the setting.",
    es:
      "Un canal puede tener ahora un agente para sus contactos y salas, aparte del que te responde a vos. Los chats " +
      "que ya están abiertos pasan a él al guardar el ajuste.",
  },
  applies: (facts) => facts.channels > 0,
  actions: [
    {
      label: { en: "Choose who answers my contacts", es: "Elegir quién responde a mis contactos" },
      prompt: "Tell me which agent should answer my channel's contacts and rooms, and explain what changes for them.",
    },
  ],
  text:
    "A channel has one agent for the owner's own chat and an optional contacts agent (contacts_agent_id) for its " +
    "contacts and rooms. Without one, the channel's agent answers contacts too. Saving it moves the chats already " +
    "open to that agent, except one the owner handed to another agent; the owner's own chat stays with the " +
    "channel's agent. Offer it only when the owner asks who answers their contacts.",
};
