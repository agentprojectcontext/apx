import type { NewsEntry } from "./entries.ts";

export const PHONE_NODE_NEWS: NewsEntry = {
  id: "phone-node",
  since: "2.18.0",
  title: { en: "Your agents can use your phone", es: "Tus agentes pueden usar tu teléfono" },
  about: {
    en: "While the APX app is open on your paired phone, agents can ask where you are and ask you for a picture, which you take yourself.",
    es: "Mientras la app de APX está abierta en tu teléfono emparejado, los agentes pueden preguntar dónde estás y pedirte una foto, que sacás vos.",
  },
  applies: (facts) => facts.phone === true,
  text:
    "The owner's paired phone now lends itself to the core while the APX app is open on it: phone_location tells " +
    "where the phone is (Android asks the owner once for the permission), and phone_photo opens the camera on the " +
    "phone with the reason you give, and the owner takes the picture or declines. Before this the phone never " +
    "connected, so the tools were never offered. Use them when where the owner is or what they are looking at " +
    "answers what they asked (how long to a place, what a label or a screen says); never to follow them, and say " +
    "why when you ask for a picture.",
  actions: [
    {
      label: { en: "Tell me where I am", es: "Decime dónde estoy" },
      prompt: "Use my phone to tell me where I am right now, in plain words: the neighbourhood or the nearest street.",
    },
  ],
};
