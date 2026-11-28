import type { NewsEntry } from "./entries.ts";

export const VOICE_GREETING_NEWS: NewsEntry = {
  id: "voice-instant-greeting",
  since: "2.18.1",
  title: { en: "Start speaking after the greeting", es: "Empezá a hablar después del saludo" },
  about: {
    en: "Wake your agent by name: your phone or computer plays its prepared greeting while the voice gets ready.",
    es: "Despertá a tu agente por su nombre: el teléfono o la computadora reproduce el saludo preparado mientras se alista la voz.",
  },
  applies: (facts) => (facts.devices ?? 0) > 0,
  text: "When wake by voice is enabled, the phone or computer keeps a greeting prepared in the selected voice and language. After saying the agent's name, wait for that greeting to finish and start your request while the voice loads; APX temporarily holds up to 30 seconds of request audio for the same call, without storing it as a recording. Changing the voice, language or owner's name prepares a new greeting, and Settings shows when it is preparing. Calls opened with a button still greet after the voice is ready. Do not claim a prepared greeting exists until the voice status confirms it; if none is ready the call uses its normal greeting.",
  actions: [
    {
      label: { en: "Check wake by voice", es: "Revisar el despertar por voz" },
      prompt: "Help me check wake by voice and whether the greeting is ready, without changing my voice settings.",
    },
  ],
};
