import type { NewsEntry } from "./entries.ts";

export const CHAT_CONTINUATIONS_NEWS: NewsEntry = {
  id: "chat-continuations",
  since: "2.17.0",
  title: { en: "Return to this chat later", es: "Volver a este chat más tarde" },
  about: {
    en: "Ask for a one-time check at a time or when a task finishes. Its receipt, cancellation and result stay in the same chat, even with notifications muted.",
    es: "Pedí una comprobación puntual por hora o cuando termine una tarea. El comprobante, la cancelación y el resultado quedan en el mismo chat, incluso con los avisos silenciados.",
  },
  applies: () => true,
  text: "The owner can ask you to return once to this same chat at a time or when an open task in its project is marked completed. Find chat_followup with tool_search. Persist the bounded purpose, condition and expiry before confirming; the receipt includes Cancel. Pending requests survive restarts; time catch-up is limited to 15 minutes and expiry to seven days. No model runs while waiting. Read apx-flows for the contract. The event source is task completion, not an appliance sensor: never substitute one for another. Verify read-only evidence before effects and use current permissions. Results or blockers stay in this chat even if push is muted. Groups and contacts' chats are not supported.",
  actions: [
    {
      label: { en: "Plan a check", es: "Programar una comprobación" },
      prompt:
        "Help me plan one bounded check to return to this chat for. Ask what I want checked, when and when it should expire; save nothing until I specify it.",
    },
  ],
};
