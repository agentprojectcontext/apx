import type { NewsEntry } from "./entries.ts";

export const COMPUTER_POINTER_NEWS: NewsEntry = {
  id: "visible-computer-pointer",
  since: "2.13.0",
  title: { en: "See who is working on your Mac", es: "Mirá quién está trabajando en tu Mac" },
  about: {
    en: "A small animated cursor shows what each agent is about to do, without taking your mouse on a journey.",
    es: "Un cursor chico y animado muestra qué está por hacer cada agente, sin llevarse tu mouse de paseo.",
  },
  applies: (facts) => facts.mac,
  text: "An updated macOS Desktop shows a persistent native agent cursor with a curved, eased journey, white and green arrow, sparks, click pulse and rounded action label. Agent names distinguish their labels. Only this drawn cursor travels. With computer use enabled, screen_do can explicitly request pointer: visible for a native accessible press that does not move the owner's pointer. Unsupported, secure and recognized web controls refuse without a physical-click fallback or automatic retry. Coordinate clicks try accessibility first and otherwise click for real, putting the owner's pointer straight back. Stop hides the indicator and cancels undelivered actions, but cannot undo a delivered effect. Windows retains the existing indicator. Ask the owner which harmless native control to try; do not bypass browser policy or handle credentials.",
  actions: [
    {
      label: { en: "Try the agent cursor", es: "Probar el cursor del agente" },
      prompt:
        "Help me try the new agent cursor on my Mac with a harmless native control I choose. Check my Desktop supports it and ask for approval before clicking. Do not send anything or handle credentials.",
    },
  ],
};
