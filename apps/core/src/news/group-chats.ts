import type { NewsEntry } from "./entries.ts";

// Told once to an owner with an agent besides the super-agent: a chat with several of them at once (D-218).
export const GROUP_CHATS_NEWS: NewsEntry = {
  id: "group-chats",
  since: "2.14.3",
  title: { en: "Talk to several agents in one chat", es: "Hablá con varios agentes en un chat" },
  about: {
    en: "Make a group of two to five agents from New chat. When you write, the ones your message is for answer, one after the other; @name asks one of them.",
    es: "Armá un grupo de dos a cinco agentes desde Nuevo chat. Cuando escribís, responden aquellos a quienes va tu mensaje, uno después del otro; @nombre le pregunta a uno.",
  },
  applies: (facts) => (facts.agents ?? 0) >= 1,
  text: "The owner can now make a group chat of two to five agents in the panel: New chat, then New group, pick the agents and an optional name. In the group only the owner's words and each agent's answer show; each agent does its work in a chat of its own under the group, opened from its name in the group's header. Who answers: the agents the owner names (with or without @; typing @ lists the members), otherwise a quick pick of the fewest whose role the message needs (everyone when the owner asks the whole group), one after the other so each reads the answers before it. An agent can ask a teammate by @mentioning them in its answer; that teammate answers next. The group's card (Group in its header) adds or takes out agents and sets the model each one answers with there, or one for everyone, and the model that picks who answers. Groups take text for now, no files. Groups are made in the panel, not by you: offer to say which of their agents would make a good group for something they are working on.",
  actions: [
    {
      label: { en: "Which agents for a group?", es: "¿Qué agentes juntar en un grupo?" },
      prompt:
        "Which of my agents would make a good group chat together for what I am working on, and how do I make one?",
    },
  ],
};
