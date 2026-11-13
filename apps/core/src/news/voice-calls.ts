import type { NewsEntry } from "./entries.ts";

export const VOICE_CALLS_NEWS: NewsEntry = {
  id: "voice-calls",
  since: "2.15.0",
  title: { en: "APX has a voice, and you can call your agents", es: "APX tiene voz, y podés llamar a tus agentes" },
  about: {
    en: "Your agents speak with APX's own voice, in Spanish or English, and you can call any of them: what needs real work keeps going during the call, and you hear the answer when it is ready.",
    es: "Tus agentes hablan con la voz propia de APX, en español o en inglés, y podés llamar a cualquiera: lo que necesita trabajo de verdad sigue durante la llamada, y escuchás la respuesta cuando está lista.",
  },
  applies: (facts) => facts.mac,
  text: "APX now has a voice of its own on this Mac (Settings › Voices): female or male, in Argentine Spanish, neutral Spanish or American English. Agents speak their voice notes with it and it transcribes the owner's, with no service to set up; it downloads on its own where the Mac can run it (it needs uv). The owner can also call any agent from the panel (the phone button at the top for the super-agent, or Call on any agent): the call talks with the owner's main model, and whatever needs real work goes to the agent called, inside the call, with its answer read aloud when ready while the conversation goes on. Each call is one chat in the Calls group.",
  actions: [
    {
      label: { en: "Set up my voice", es: "Configurar mi voz" },
      prompt: "Help me set up APX's voice and calls: check what this Mac still needs and walk me through it.",
    },
  ],
};
