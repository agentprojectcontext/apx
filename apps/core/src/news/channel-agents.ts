import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a channel: each account of a chat app can be answered by a project's agent.
export const CHANNEL_AGENTS_NEWS: NewsEntry = {
  id: "channel-agents",
  since: "2.14.0",
  title: {
    en: "A project's agent on each channel",
    es: "Un agente de proyecto en cada canal",
  },
  about: {
    en:
      "Connect more than one account of the same app (two WhatsApp numbers, two bots) and choose who answers each: " +
      "your super-agent or a project's head, for you and, separately, for your contacts.",
    es:
      "Conectá más de una cuenta de la misma app (dos números de WhatsApp, dos bots) y elegí quién atiende cada una: " +
      "tu super-agente o el responsable de un proyecto, para vos y, aparte, para tus contactos.",
  },
  applies: (facts) => facts.channels > 0,
  text:
    "Each channel account (the channels.list setting) can now be answered by a project's head instead of the super-agent: its " +
    "chats then work in that project, with its team, folders and memory. A channel has the agent the owner talks to " +
    "(agent_id; Home only while that is the super-agent, any other agent answers in the channel's own chat) and, " +
    "optionally, another agent for its contacts and rooms (contacts_agent_id). Changing either one moves the open " +
    "chats it answered, except one the owner handed to another agent. The owner can also connect more accounts of the " +
    "same app in Channels (its own screen in the sidebar) › New channel; each has its own sign-in, contacts and " +
    "agents, and iMessage stays " +
    "one. Each account can also set what its contacts may do by default (take requests, appointment requests, answer " +
    "from the owner's notes, answer at any hour: channels.set contacts); what the owner sets on one contact's card " +
    "(contacts.set perms) wins, and null gives it back to the account. Offer to review which agent answers each of " +
    "their channels; change one only when they ask.",
  actions: [
    {
      label: { en: "Review who answers my channels", es: "Revisar quién atiende mis canales" },
      prompt:
        "List my channel accounts with who answers me and who answers my contacts on each, and suggest a project's " +
        "agent where it fits. Change nothing until I say so.",
    },
  ],
};
