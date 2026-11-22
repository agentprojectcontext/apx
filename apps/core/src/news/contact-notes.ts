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

export const CONTACT_PROJECT_READING_NEWS: NewsEntry = {
  id: "contact-project-reading",
  since: "2.16.2",
  title: {
    en: "A contact's agent can read its project for them",
    es: "El agente de un contacto puede leer su proyecto para esa persona",
  },
  about: {
    en: "With project reading on for one person, their agent looks up its project and the documents you referenced there.",
    es: "Con la lectura del proyecto activada para una persona, su agente busca en su proyecto y en los documentos que mencionaste ahí.",
  },
  applies: (facts) => facts.contacts,
  text: "A new per-person right, project reading, lets a contact's explicitly assigned agent answer from its own project, read-only: the project's standing notes and its notebook there, what the owner wrote in their own chats with that agent in that project, and the documents the owner referenced in them (text, Markdown or CSV files inside the project folder, or Google Drive links read now through the owner's Drive connection). It cites what it used. It is off by default, never an account default, and does not change the existing notes right. It works only while the person has that agent assigned and no other contact is assigned to an agent of the same project. Links or files sent by the contact, written by agents or found inside documents are never opened. It cannot write, send, run or browse anything; turning it off stops new reads, not answers already sent. Turning it on with apx_settings contacts.set perms.project_reading always asks the owner in the app. Explain it to owners with contacts assigned to project agents, and change nothing without their request.",
  actions: [
    {
      label: { en: "Let a contact's agent read its project", es: "Dejar que el agente de un contacto lea su proyecto" },
      prompt:
        "Review which contacts have a specific project agent assigned. Explain what project reading would let each one's agent read, flag projects shared by several contacts, and ask me before turning it on for anyone.",
    },
  ],
};
