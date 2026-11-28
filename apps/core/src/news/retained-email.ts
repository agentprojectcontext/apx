import type { NewsEntry } from "./entries.ts";

export const RETAINED_EMAIL_NEWS: NewsEntry = {
  id: "email-retained-history",
  since: "2.14.0",
  title: {
    en: "Keep automatic mail without automatic replies",
    es: "Guardá correo automático sin respuestas automáticas",
  },
  about: {
    en: "Account notices and newsletters now stay in your Email chats. You can also recover older mail quietly from the terminal.",
    es: "Los avisos de cuentas y boletines ahora quedan en tus chats de Email. También podés recuperar correo anterior sin avisos desde la terminal.",
  },
  applies: (facts) => facts.email,
  text: "Email channels keep automatic mail that passes the account's existing sender checks and filters, without starting automatic replies. New mail can still be checked for importance. The owner can explicitly recover retained mailbox history with apx channels email-history, one bounded page at a time; it deduplicates stored messages and starts no replies, agent turns or alerts for history. Recovery is owner-only because importing private history must be an explicit choice. Never claim old mail has already been recovered; show verified counts and filtering limits.",
  actions: [
    {
      label: { en: "Check missing mail", es: "Revisar correo faltante" },
      prompt:
        "Help me check which Email messages are missing and explain how to recover retained mailbox history quietly.",
    },
  ],
};
