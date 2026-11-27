import type { enAutoDecisions } from "./auto-decisions-en.ts";

export const esAutoDecisions: Record<keyof typeof enAutoDecisions, string> = {
  "autoDel.title": "Lo que decidió Auto",
  "autoDel.lead":
    "En Auto, lo que hace un agente que no es claramente seguro se mira solo: un borrado, una página con contenido de afuera, un comando en otra máquina. Lo que el trabajo claramente pide sigue, el resto te pregunta. Acá podés revisar cada uno.",
  "autoDel.all": "Todos",
  "autoDel.onlyRan": "Siguió",
  "autoDel.onlyAsked": "Te preguntó",
  "autoDel.filter": "Qué decisiones",
  "autoDel.empty":
    "Cada vez que un agente en Auto siga con algo dudoso, o te pregunte antes, aparece acá con el porqué.",
  "autoDel.error": "No se pudo cargar la lista.",
  "autoDel.retry": "Intentar de nuevo",
  "autoDel.older": "Ver anteriores",
  "autoDel.openChat": "Abrir el chat",
  "autoDel.rule": "Regla fija",
  "autoDel.helper": "Modelo ayudante",
};
