import type { NewsEntry } from "./entries.ts";

// Told once to an owner whose agents answer contacts: one person can have an agent of their own.
export const CONTACT_AGENT_NEWS: NewsEntry = {
  id: "contact-agent",
  since: "2.14.0",
  title: {
    en: "An agent for one contact",
    es: "Un agente para un contacto",
  },
  about: {
    en:
      "Give one contact an agent of their own, on every account, instead of the one the account has for its contacts; " +
      "and silence an account's notices from its right-click menu.",
    es:
      "Dale a un contacto un agente propio, en todas las cuentas, en vez del que la cuenta tiene para sus contactos; y " +
      "silenciá los avisos de una cuenta desde su menú de clic derecho.",
  },
  applies: (facts) => facts.contacts,
  text:
    "A contact can now be answered by an agent of their own (contacts.set agent_id; null gives them back to the " +
    "account's contacts agent): it answers them on every channel, their open chats move to it, and changing an " +
    "account's contacts agent leaves them with theirs. The owner sets it on the contact's card (Answers). A channel " +
    "can also have its notices silenced (channels.set quiet): what happens on it stays out of the tray and the owner's " +
    "chat app, failures aside. Offer to give a contact who needs it (a client a project's head should handle) their " +
    "own agent; change nothing until the owner says so.",
  actions: [
    {
      label: { en: "Who should answer my contacts", es: "Quién debería atender a mis contactos" },
      prompt:
        "Look at my contacts and the agents that answer them, and suggest one who would be better answered by an agent " +
        "of their own. Change nothing until I say so.",
    },
  ],
};
