import type { MessageKey } from "./en.ts";

// La columna lateral de un proyecto (sus subproyectos y agentes), sus pestañas vacías, la galería de artefactos y la
// lista de memoria.
export const esProjectSlim: Partial<Record<MessageKey, string>> = {
  "projside.label": "Subproyectos y agentes",
  "projside.openSub": "Abrir {name}",
  "projside.openAgent": "Ver a {name} en su equipo",
  "projside.own": "Propio",
  "projside.everywhere": "Todos",
  "project.emptyTab": "Todavía no hay nada acá en {name}.",
  "artifacts.openItem": "Abrir {title} al lado de la lista",
  "artifacts.byYou": "Vos",
  "memory.kindLabel": "Recuerdo",
};
