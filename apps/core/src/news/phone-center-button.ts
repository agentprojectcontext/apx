import type { NewsEntry } from "./entries.ts";

export const PHONE_CENTER_BUTTON_NEWS: NewsEntry = {
  id: "phone-center-button",
  since: "2.19.0",
  title: { en: "Your agent in the middle of the phone app", es: "Tu agente en el medio de la app del teléfono" },
  about: {
    en: "The Android app has your super-agent's button in the middle of the bottom bar: a tap calls it, or hold it to send a voice note when calls aren't ready.",
    es: "La app de Android tiene el botón de tu superagente en el medio de la barra de abajo: un toque lo llama, o mantenelo apretado para mandarle una nota de voz cuando las llamadas no están listas.",
  },
  applies: (facts) => facts.androidPhone === true,
  text: "The APX app for Android now has the super-agent's own button, with its name, in the middle of the bottom bar. When calls are ready on this computer, a tap starts a call. When they are not, holding it records a voice note, letting go sends it and sliding the finger away drops it; the note goes to the owner's pinned chat with the super-agent, else the last of its chats the owner opened, else a new one. Pinning a chat with the super-agent makes it the one notes go to. Sessions with Claude Code or Codex moved from the bottom bar to a fourth tab at the top of Chats.",
  actions: [
    {
      label: { en: "Pick where my voice notes go", es: "Elegir adónde van mis notas de voz" },
      prompt:
        "Help me choose which of our chats my voice notes from the phone's center button should go to, and pin it.",
    },
  ],
};
