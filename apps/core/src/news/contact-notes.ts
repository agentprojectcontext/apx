import type { NewsEntry } from "./entries.ts";

export const CONTACT_NOTES_NEWS: NewsEntry = {
  id: "contact-assigned-agent-notes",
  since: "2.16.1",
  title: { en: "Your contact's agent can use its notes", es: "El agente de tu contacto puede usar sus notas" },
  about: {
    en: "An agent you choose for a contact can answer from its project's notes when you allow answers from notes.",
    es: "El agente que elegís para un contacto puede responder desde las notas de su proyecto si permitís contestar desde notas.",
  },
  applies: (facts) => facts.contacts,
  text: "When the owner explicitly assigns an agent to a contact and enables answers from notes, that contact can now receive answers based on the project's standing notes and the assigned agent's notebook in that project. This includes agent-saved notes. No files, past chats, other projects or other agents' notebooks are shared. Account-default routing alone still permits only owner-written general notes. Turning notes off stops new searches, not answers already sent. Explain this scope to owners who already have notes enabled and offer to review their contact assignments and permissions. Change nothing without their request.",
  actions: [
    {
      label: { en: "Review my contacts' notes access", es: "Revisar el acceso a notas de mis contactos" },
      prompt:
        "Review which contacts have an agent specifically assigned and answers from notes enabled. Explain what each can access and suggest changes without applying them.",
    },
  ],
};
