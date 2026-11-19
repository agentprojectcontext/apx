import type { NewsEntry } from "./entries.ts";

export const CALL_SERVICES_NEWS: NewsEntry = {
  id: "call-speech-services",
  since: "2.15.3",
  title: { en: "Choose the voice for your calls", es: "Elegí la voz de tus llamadas" },
  about: {
    en: "Call your agents with speech and transcription services on Windows, Linux or macOS. Choose Gemini, ElevenLabs or an OpenAI-compatible voice server.",
    es: "Llamá a tus agentes con servicios de voz y transcripción en Windows, Linux o macOS. Elegí Gemini, ElevenLabs o un servidor de voz compatible con OpenAI.",
  },
  applies: () => true,
  text: "Settings › Voice and calls now lets the owner choose speech and transcription independently for calls, including remote services on Windows and Linux. Existing Gemini, OpenAI and compatible speech services work, and ElevenLabs can be added with its API key and voice ID. A custom OpenAI-compatible URL can point at QVox, a private PC or a VPS. Only the local APX voice requires Apple silicon. Help the owner choose services; do not change their selections without asking. Calls using services synthesize each sentence before playback and do not show live partial transcription.",
  actions: [
    {
      label: { en: "Set up call services", es: "Configurar servicios para llamadas" },
      prompt:
        "Help me choose speech and transcription services for calls in Settings › Voice and calls, using the services I already have when possible.",
    },
  ],
};
