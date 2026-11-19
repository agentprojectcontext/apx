import type { NewsEntry } from "./entries.ts";

// Told once to every owner: the Marketplace replaces the integrations list as the one place to add what agents can
// use (DECISIONS.md#d-241, #d-245, #d-246).
export const MARKETPLACE_NEWS: NewsEntry = {
  id: "marketplace",
  since: "2.16.0",
  title: {
    en: "The Marketplace: add anything to your agents",
    es: "El Marketplace: sumale de todo a tus agentes",
  },
  about: {
    en:
      "Everything your agents can use is now in one place: the accounts that come with APX, extensions published by " +
      "APX and ones from other catalogs, each with what it brings, who makes it and what it can reach. Adding, " +
      "connecting or pairing a device happens in one box, and you can also open an .apxext file or add a catalog.",
    es:
      "Todo lo que pueden usar tus agentes ahora está en un solo lugar: las cuentas que vienen con APX, las " +
      "extensiones que publica APX y las de otros catálogos, cada una con lo que trae, quién la hace y a qué puede " +
      "llegar. Agregar, conectar o emparejar un dispositivo se hace en un solo cuadro, y también podés abrir un " +
      "archivo .apxext o sumar un catálogo.",
  },
  applies: () => true,
  text:
    "[The Marketplace](apx:marketplace) is where the owner adds what agents can use: included " +
    "accounts (Gmail, Calendar, Asana…), extensions APX publishes (Official) and ones from catalogs the owner added " +
    "(Claude Code's format too), each with skills, tools, agents, routines or an app on a device. Read what exists " +
    "with apx_settings extensions.catalog and what is already there with extensions.list; adding, removing and " +
    "catalogs stay the owner's, so point them to the Marketplace instead of installing. Offer it when the owner asks " +
    "for something an extension already does, naming at most three that fit their work; add nothing yourself.",
  actions: [
    {
      label: { en: "What fits me", es: "Qué me sirve" },
      prompt:
        "Look at what I usually do with you and suggest up to three extensions from the Marketplace that would help, " +
        "with one line each on why. Don't add anything.",
    },
  ],
};
