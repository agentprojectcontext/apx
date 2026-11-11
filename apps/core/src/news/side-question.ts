import type { NewsEntry } from "./entries.ts";

export const SIDE_QUESTION_NEWS: NewsEntry = {
  id: "side-question",
  since: "2.14.0",
  title: { en: "Ask something apart from the chat", es: "Preguntá algo aparte del chat" },
  about: {
    en: "In a chat, + › Side question asks your agent something quick about that chat. The answer shows over the box where you write, and neither the question nor the answer stays in the chat.",
    es: "En un chat, + › Pregunta aparte le pregunta a tu agente algo rápido sobre ese chat. La respuesta aparece sobre el cuadro donde escribís, y ni la pregunta ni la respuesta quedan en el chat.",
  },
  applies: () => true,
  text: "In the app's chats, the + menu has Side question: the owner asks the chat's agent something quick about the chat (what was decided, a name, a summary), on the chat's model, with the chat as read-only context. The answer shows in a small panel over the composer; it is not added to the chat and the agent does not see it in later turns, and it cannot use tools there. Closing the panel lets it go. Tell the owner they can check something without cluttering a long chat.",
  actions: [
    {
      label: { en: "Show me where it is", es: "Mostrame dónde está" },
      prompt: "Where do I find the side question in a chat, and what is it good for?",
    },
  ],
};
