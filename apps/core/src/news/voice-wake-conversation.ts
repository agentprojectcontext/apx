import type { NewsEntry } from "./entries.ts";

export const VOICE_WAKE_CONVERSATION_NEWS: NewsEntry = {
  id: "voice-wake-conversation",
  since: "2.18.1",
  title: { en: "Keep talking after waking your agent", es: "Seguí hablando después de despertar a tu agente" },
  about: {
    en: 'A voice request said by name no longer hangs up after the first answer: ask, follow up, and say "that\'s all" or "listo, gracias" when you\'re done. It also hangs up after a few seconds of silence.',
    es: 'Un pedido por voz ya no corta después de la primera respuesta: pedís, seguís, y cuando terminás decís "listo, gracias" o "eso es todo". También corta tras unos segundos de silencio.',
  },
  applies: (facts) => (facts.devices ?? 0) > 0,
  text: 'A voice request the owner opens by saying the super-agent\'s name is now a short back-and-forth instead of one answer: the owner can ask, follow up ("ok, then turn it on") and ask something else, each answered in a sentence or two. It hangs up when the owner says they are done ("listo", "gracias", "eso es todo", "cortá", "that\'s all", "thanks"), after about 9 seconds with nobody speaking (up to 25 seconds while something asked is still being worked on), or, when the voice could not make out what the owner wants twice in a row, after saying so ("No te entendí; cualquier cosa me volvés a llamar"). In the panel these requests show under Calls as Voice request with a microphone and Hands-free. Offer to try it with something quick from their day.',
  actions: [
    {
      label: { en: "Try a voice request", es: "Probar un pedido por voz" },
      prompt: "How do I wake you by voice from my phone, and what can I ask you that way?",
    },
  ],
};
