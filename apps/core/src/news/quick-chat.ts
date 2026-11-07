import type { NewsEntry } from "./entries.ts";

export const QUICK_CHAT_NEWS: NewsEntry = {
  id: "quick-chat-agents",
  since: "2.13.0",
  title: { en: "Choose an agent in quick chat", es: "Elegí un agente en el chat rápido" },
  about: {
    en: "Start a conversation with any of your agents from quick chat. Search by agent or project; each keeps its model settings.",
    es: "Empezá una conversación con cualquiera de tus agentes desde el chat rápido. Buscá por agente o proyecto; cada uno conserva su configuración de modelos.",
  },
  applies: (facts) => facts.desktop === true,
  text: "The desktop quick-chat window now offers the same searchable New chat agent picker as the full panel, including the super-agent, project groups and recent agents. Selecting an agent opens a draft with its project and model settings; canceling preserves the current conversation. No saved chat is created until the first message.",
  actions: [
    {
      label: { en: "How to choose an agent", es: "Cómo elegir un agente" },
      prompt: "Show me how to choose an agent and project in the desktop quick-chat window.",
    },
  ],
};
