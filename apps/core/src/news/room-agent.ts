import type { NewsEntry } from "./entries.ts";

// Told once to an owner whose accounts have rooms or groups: one room can have an agent of its own.
export const ROOM_AGENT_NEWS: NewsEntry = {
  id: "room-agent",
  since: "2.14.0",
  title: {
    en: "An agent for one room",
    es: "Un agente para una sala",
  },
  about: {
    en: "Give one room or group an agent of its own from its card, beside its chat, instead of the account's.",
    es: "Dale a una sala o grupo un agente propio desde su tarjeta, al costado del chat, en vez del de la cuenta.",
  },
  applies: (facts) => Boolean(facts.rooms),
  text:
    "A room or group can now be answered by an agent of its own (channels.set, rooms.rooms[].agent_id; leaving it out " +
    "gives the room back to the account's contacts agent): its chat moves to that agent, and changing the account's " +
    "contacts agent leaves it with its own. The owner sets it on the room's card beside its chat (Answers), where " +
    "Read only also silences the room. Offer it for a room a project's head should handle; change nothing until the " +
    "owner says so.",
  actions: [
    {
      label: { en: "Who should answer my rooms", es: "Quién debería atender mis salas" },
      prompt:
        "Look at my channels' rooms and groups and the agent that answers each, and suggest one that would be better " +
        "answered by an agent of its own. Change nothing until I say so.",
    },
  ],
};
