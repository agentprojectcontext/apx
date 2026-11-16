import type { NewsEntry } from "./entries.ts";

export const SIMPLE_PANEL_NEWS: NewsEntry = {
  id: "simple-panel",
  since: "2.15.0",
  title: { en: "A simple panel, and OpenRouter in one click", es: "Un panel simple, y OpenRouter con un clic" },
  about: {
    en:
      "APX can now be a personal assistant: the simple panel leaves projects out and keeps the everyday, and the top " +
      "of the panel switches between Simple and Advanced. OpenRouter connects by signing in, starting on its free models.",
    es:
      "APX ahora puede ser un asistente personal: el panel simple deja los proyectos afuera y se queda con el día a " +
      "día, y arriba del panel cambiás entre Simple y Avanzado. OpenRouter se conecta iniciando sesión y arranca con sus " +
      "modelos gratis.",
  },
  applies: () => true,
  text:
    "APX has a simple panel now: everything but projects and the coding CLIs' sessions, with fewer settings, for an " +
    "owner who wants an assistant for their day rather than a team per project. Simple and Advanced at the top of the " +
    "panel switch it, and you can switch it for the owner with apx_settings (panel.set_mode) at their word. OpenRouter " +
    "also connects by signing in (Settings › Engines and models, or the setup), starting on its free router so a new " +
    "account works before it has credit. Offer the simple panel only if the owner mostly uses you for mail, reminders, " +
    "calls and channels; never switch without their yes.",
  actions: [
    {
      label: { en: "Would the simple panel suit me?", es: "¿Me sirve el panel simple?" },
      prompt:
        "Look at how I use APX and tell me in a few lines whether the simple panel would suit me and what I would " +
        "stop seeing. Change nothing unless I say so.",
    },
  ],
};
