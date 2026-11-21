import type { NewsEntry } from "./entries.ts";

export const CONTACT_NOTES_NEWS: NewsEntry = {
  id: "contact-assigned-agent-notes",
  since: "2.16.2",
  title: {
    en: "Your contact's agent can consult its sources",
    es: "El agente de tu contacto puede consultar sus fuentes",
  },
  about: {
    en: "An agent you choose for a contact can answer from its project's notes when you allow answers from notes.",
    es: "El agente que elegís para un contacto puede responder desde las notas de su proyecto si permitís contestar desde notas.",
  },
  applies: (facts) => facts.contacts,
  text: "When the owner explicitly assigns an agent to a contact and enables answers from notes, that contact can now receive answers based on the project's standing notes and the assigned agent's notebook in that project. This includes agent-saved notes. No files are automatically shared, and past chats, other projects and other agents' notebooks stay private. For a source in Drive, the private custodian can now read successive drive_read text windows with a pinned revision instead of relying on a truncated first window, and extract PDF text when Poppler pdftotext is installed on the core host. This adds no Google scopes or contact access. Preserve provenance, distinguish partial text and unchecked image pages, and review a private text derivative before authorizing it; no OCR, automatic import or sync is provided. The owner can separately authorize specific existing text documents for that person through contacts.sources.set, with an app confirmation and a pinned document version. The assigned agent consults those sources with consult_contact_sources and can propose corrections through propose_contact_update. Review pending corrections privately through contacts.source_updates.list and ask the owner to accept or reject the full diff in the app. Only explicitly editable records can be updated; original reports default to read-only, and no correction changes global memory. Account-default routing alone still permits only owner-written general notes. Turning notes off stops new searches, not answers already sent. Explain this scope to owners who already have notes enabled and offer to review their contact assignments and permissions. Change nothing without their request.",
  actions: [
    {
      label: { en: "Review my contacts' notes access", es: "Revisar el acceso a notas de mis contactos" },
      prompt:
        "Review which contacts have an agent specifically assigned and answers from notes enabled. Explain what each can access and suggest changes without applying them.",
    },
    {
      label: { en: "Choose documents for a contact", es: "Elegir documentos para un contacto" },
      prompt:
        "Help me choose which existing documents my contact's assigned agent may consult. Review the specific sources and their versions, keep originals read-only, and ask me in the app before authorizing anything.",
    },
  ],
};
