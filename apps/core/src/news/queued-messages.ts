import type { NewsEntry } from "./entries.ts";

export const QUEUED_MESSAGES_NEWS: NewsEntry = {
  id: "queued-messages",
  since: "2.13.0",
  title: { en: "Write while your agent works", es: "Escribí mientras tu agente trabaja" },
  about: {
    en: "A message you send while your agent works is read at its next step, or at once with Send now. With Ctrl/⌘+Enter it waits in line for when it finishes, and you can edit, move or remove it until then.",
    es: "Un mensaje que mandás mientras tu agente trabaja lo lee en su próximo paso, o en el momento con Enviar ahora. Con Ctrl/⌘+Enter queda en cola para cuando termine, y hasta entonces lo podés editar, mover o quitar.",
  },
  applies: () => true,
  text: "In the app, while an agent works: Enter sends a message that the running turn reads at its next step, and Send now under it stops the step in progress so the agent reads it at once. Ctrl/⌘+Enter puts the message in line for when the turn finishes; until then the owner can edit, reorder, remove it or send it now. Stop still stops everything. Tell the owner they can write to you while you work without stopping you.",
  actions: [
    {
      label: { en: "Try it with a long task", es: "Probarlo con una tarea larga" },
      prompt:
        "Start something that takes you a few steps, so I can try writing to you while you work and putting a message in line.",
    },
  ],
};
