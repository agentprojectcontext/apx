import type { NewsEntry } from "./entries.ts";

export const VOICE_CALLS_NEWS: NewsEntry = {
  id: "voice-calls",
  since: "2.15.0",
  title: { en: "Call your super-agent", es: "Llamá a tu super-agente" },
  about: {
    en: "Talk to your super-agent by voice. It answers right away, and what needs real work keeps going during the call: you hear the answer when it is ready.",
    es: "Hablale a tu super-agente con la voz. Te contesta enseguida, y lo que necesita trabajo de verdad sigue durante la llamada: escuchás la respuesta cuando está lista.",
  },
  applies: (facts) => facts.mac,
  text: "The owner can now call the super-agent from the panel (the phone button at the top, or in the super-agent's own chat). A fast voice model on this Mac answers by voice; whatever needs real work (a project, mail, the calendar, the web) goes to the super-agent inside the call and its answer is read aloud when ready, while the conversation goes on. Each call is one chat in the Calls group, with what was asked shown inside it. It needs a Mac with Apple silicon, uv and a cloned voice; the first call downloads its speech models.",
  actions: [
    {
      label: { en: "Set up calls", es: "Configurar las llamadas" },
      prompt: "Help me set up voice calls with you: check what this Mac still needs and walk me through it.",
    },
  ],
};
