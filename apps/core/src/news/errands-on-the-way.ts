import type { NewsEntry } from "./entries.ts";

export const ERRANDS_ON_THE_WAY_NEWS: NewsEntry = {
  id: "errands-on-the-way",
  since: "2.18.0",
  title: { en: "Errands on the way", es: "Recados en el camino" },
  about: {
    en: "While you drive, APX finds a place for your errands near the way and asks on the car whether to go.",
    es: "Mientras manejás, APX busca un lugar para tus recados cerca del camino y te pregunta en el auto si querés ir.",
  },
  applies: (facts) => facts.secretary && (facts.devices ?? 0) > 0,
  text: "Errands now work on the road. With In the car on (Settings › In the car on the Android phone, and in the panel), the phone tells APX when the owner drives, and APX offers a nearby place for each open errand on the car screen, the phone and the panel: go, another place, later, not this trip, done. When you create an errand, give it a place: task_create with kind errand and place.categories (supermarket, pharmacy, stationery…, best first) and a brand if they named one. Places they choose rank first next time. Offer once to turn it on, and to give a place to their open errands.",
  actions: [
    {
      label: { en: "Set up my errands", es: "Preparar mis recados" },
      prompt:
        "Turn on errands on the way for me, and give a place (the kind of shop, and a brand if I named one) to my open errands. Then tell me what to do on the phone.",
    },
  ],
};
