import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a room listed: what they ask in a room that needs tools now gets done, in private.
export const ROOM_HANDOFF_NEWS: NewsEntry = {
  id: "room-handoff",
  since: "2.14.0",
  title: {
    en: "Ask in a room, get it done in private",
    es: "Pedí en una sala, se hace en privado",
  },
  about: {
    en:
      "When you ask your agent for something in a Discord room or a group that needs more than an answer, it tells " +
      "the room it is on its way and does it from Home; you get the result in private, not in the room.",
    es:
      "Cuando le pedís algo a tu agente en una sala de Discord o un grupo y hace falta más que una respuesta, avisa en " +
      "la sala que ya va y lo hace desde Home; el resultado te llega en privado, no en la sala.",
  },
  applies: (facts) => facts.rooms === true,
  text:
    "When the owner writes in one of their rooms (a Discord channel, a Telegram group) and asks for something " +
    "that needs tools, the room's agent no longer only promises it: it says in the room that it is on its way, and APX " +
    "passes the owner's own message, as they wrote it, to Home, where it is done and the answer reaches them where " +
    "they hear from Home. Only the owner's messages (checked by their account) are passed on, never a member's. On " +
    "Telegram, WhatsApp and Signal groups it starts at once; on Discord and the rest the super-agent first " +
    "checks it is really the owner, as with their other messages there. Offer to try it from a room.",
  actions: [
    {
      label: { en: "Which rooms can I ask from?", es: "¿Desde qué salas puedo pedir?" },
      prompt: "List the rooms you read on my channels and tell me how to ask you for something from one of them.",
    },
  ],
};
