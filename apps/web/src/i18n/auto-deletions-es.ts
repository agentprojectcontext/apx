import type { enAutoDeletions } from "./auto-deletions-en.ts";

export const esAutoDeletions: Record<keyof typeof enAutoDeletions, string> = {
  "autoDel.title": "Lo que borró Auto",
  "autoDel.lead":
    "En Auto, cada borrado de un agente se mira solo: lo que claramente vuelve solo se borra sin preguntar, el resto te pregunta. Acá podés revisar cada uno.",
  "autoDel.all": "Todos",
  "autoDel.onlyRan": "Borrados",
  "autoDel.onlyAsked": "Preguntados",
  "autoDel.filter": "Qué decisiones",
  "autoDel.empty": "Cada vez que un agente en Auto borre algo, o te pregunte antes, aparece acá con el porqué.",
  "autoDel.error": "No se pudo cargar la lista.",
  "autoDel.retry": "Intentar de nuevo",
  "autoDel.older": "Ver anteriores",
  "autoDel.openChat": "Abrir el chat",
  "autoDel.rule": "Regla fija",
  "autoDel.helper": "Modelo ayudante",
};
