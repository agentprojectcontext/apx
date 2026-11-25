import type { NewsEntry } from "./entries.ts";

export const CONTACT_CONSULT_REFERENCE_NEWS: NewsEntry = {
  id: "contact-consult-reference",
  since: "2.17.0",
  title: {
    en: "Read what your contact's agent asked",
    es: "Leé qué preguntó el agente de tu contacto",
  },
  about: {
    en: "A question preview in the contact's chat opens the actual consultation beside it.",
    es: "El fragmento de la pregunta en el chat del contacto abre la consulta real al costado.",
  },
  applies: (facts) => facts.contacts,
  text: "In the app's supervised contact chat, new consultations show the actual question and who asked whom. Selecting the compact reference opens the real read-only conversation in the side panel without leaving the contact's chat. On a phone it opens in the available space and can be closed to return. These references are only for the owner in the app: no question or private instructions are sent to the contact by this display change, and no permissions change. Historical activity without a question preview or an available conversation stays a plain note. Offer to help the owner find a recent consultation rather than asking a contact to repeat anything.",
  actions: [
    {
      label: { en: "Find a recent consultation", es: "Encontrar una consulta reciente" },
      prompt:
        "Help me find a recent consultation from a contact's assigned agent and explain how to open the real conversation in the app. Do not send a message or change anyone's permissions.",
    },
  ],
};
