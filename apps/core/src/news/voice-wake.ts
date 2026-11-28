import type { NewsEntry } from "./entries.ts";

export const VOICE_WAKE_NEWS: NewsEntry = {
  id: "voice-wake",
  since: "2.18.0",
  title: { en: "Wake your agent by voice", es: "Despertá a tu agente con la voz" },
  about: {
    en: 'Say "ok" or "che" and your super-agent\'s name, even with the phone locked, and a quick voice request opens: you ask, it answers in a sentence and hangs up.',
    es: 'Decí "ok" o "che" y el nombre de tu superagente, incluso con el teléfono bloqueado, y se abre un pedido rápido por voz: pedís, responde en una frase y corta.',
  },
  applies: (facts) => (facts.devices ?? 0) > 0,
  text: 'The owner can now wake the super-agent by voice. In the APX app for Android, Settings has a Despertar por voz switch (per phone): the phone listens in the background, picks out speech by loudness and sends only short clips to this computer, which transcribes them and checks for the agent\'s name; nothing is kept. When the owner says a phrase like "ok" or "che" plus the name, the voice answers, a floating panel opens over whatever is on screen (even the lock screen), the owner asks, and the voice answers in one short sentence and hangs up. It needs the display-over-other-apps permission, and some phones stop background apps to save battery. The phrases are set in Settings > Voice and calls > Wake by voice (shared by every device), where this computer can listen too. Saying "cortá" or "that\'s all" ends any call.',
  actions: [
    {
      label: { en: "Set up wake by voice", es: "Configurar el despertar por voz" },
      prompt:
        "Help me set up waking my agent by voice: check that calls and my voice are ready and walk me through turning it on in the phone app.",
    },
  ],
};
