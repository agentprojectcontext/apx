import type { NewsEntry } from "./entries.ts";

// Told once to an owner with more than one channel: Home moves to another chat app when they ask (DECISIONS.md#d-224).
export const HOME_CHANNEL_SWITCH_NEWS: NewsEntry = {
  id: "home-channel-switch",
  since: "2.14.3",
  title: {
    en: "Move the conversation to another chat app",
    es: "Mové la conversación a otra app de chat",
  },
  about: {
    en:
      'Say "let\'s go on in Telegram" and your agent writes there right away and goes on there. Results of work it ' +
      "passed to other agents reach you where you last wrote, not where the work started.",
    es:
      'Decí "sigamos por Telegram" y tu agente escribe ahí enseguida y sigue ahí. Los resultados de lo que pasó a otros ' +
      "agentes te llegan donde escribiste por última vez, no donde empezó el trabajo.",
  },
  applies: (facts) => facts.channels > 1,
  text:
    "The owner can move their conversation with you to another of their chat apps: when they ask to go on there, send " +
    'them a short line there with message_contact (to "me", that channel, stay) and you go on there; the chat app they ' +
    'were on gets nothing more. A one-off "send me this there" is the same send without stay. What your team\'s agents ' +
    "answer later now reaches them where they last wrote. Tell them they can try it.",
  actions: [
    {
      label: { en: "Go on in another chat app", es: "Seguir en otra app de chat" },
      prompt: "Which of my chat apps can we move this conversation to? Ask me which one, then go on there.",
    },
  ],
};
