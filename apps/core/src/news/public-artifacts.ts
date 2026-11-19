import type { NewsEntry } from "./entries.ts";

// Told once to owners with artifacts: a widget or app can get its own public link (DECISIONS.md#d-248).
export const PUBLIC_ARTIFACTS_NEWS: NewsEntry = {
  id: "public-artifacts",
  since: "2.16.0",
  title: {
    en: "Share a widget with a public link",
    es: "Compartí un widget con un link público",
  },
  about: {
    en:
      "Any widget, app or page you have can get its own link on artifact.apxagent.app, for anyone to open without " +
      "APX. Nothing goes public until you publish it and approve exactly what is shared, and you can stop " +
      "publishing it whenever you want. It needs your APX account and up to 10 MB.",
    es:
      "Cualquier widget, app o página que tengas puede tener su propio link en artifact.apxagent.app, para que " +
      "cualquiera lo abra sin APX. Nada se vuelve público hasta que lo publicás y aprobás exactamente qué se " +
      "comparte, y podés dejar de publicarlo cuando quieras. Necesita tu cuenta APX y hasta 10 MB.",
  },
  applies: (facts) => facts.artifacts > 0,
  text:
    "An artifact can get a public copy at artifact.apxagent.app/<code>, a random code per artifact, viewable by anyone " +
    "with the link. Prepare it with apx_settings surfaces.public_prepare (state is left out unless the owner names " +
    "state_keys) and send the draft to surfaces.public_commit: the owner always approves the exact copy on a card, in " +
    "every mode, and the same goes for updating or stopping it. It needs the owner signed in to their APX account " +
    "and at most 10 MB; a bigger one stays local and you say so. surfaces.public_list shows what is published. Offer " +
    "it when the owner wants to show a widget to someone who has no APX; never publish on your own.",
  actions: [
    {
      label: { en: "Share one", es: "Compartir uno" },
      prompt:
        "List my widgets and apps and help me pick one to share with a public link. Show me exactly what would be " +
        "published and wait for my approval.",
    },
  ],
};
