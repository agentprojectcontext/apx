import type { enMemoryPanel } from "./memory-panel-en.ts";

// La pestaña Memoria de un proyecto: la nota al lado de la lista y el chat que repasa las notas con un agente.
export const esMemoryPanel: Record<keyof typeof enMemoryPanel, string> = {
  "memory.kind.user": "Sobre vos",
  "memory.kind.feedback": "Indicación",
  "memory.kind.project": "Del proyecto",
  "memory.kind.reference": "Referencia",
  "memory.kind.procedure": "Cómo se hizo",
  "memory.panel.label": "Nota de memoria",
  "memory.panel.writtenBy": "La escribió",
  "memory.panel.updated": "Actualizada {when}",
  "memory.panel.forgotten": "Olvidada {when}",
  "memory.panel.gone": "Esta nota ya no está en la lista.",
  "memory.review.with": "Revisar con {name}",
  "memory.review.title": "Revisión de memoria",
  "memory.review.drawer": "Revisando con {name}",
  "memory.review.hint":
    "Mandá el mensaje para empezar: {name} lee las notas y te propone qué dejar, corregir u olvidar, una por una.",
  "memory.review.new": "Empezar otra revisión",
  "memory.review.open": "Abrir el chat completo",
  "memory.review.back": "Volver a la nota",
  "memory.review.noAgent": "No hay un agente que pueda revisar estas notas.",
  "memory.review.draft.project":
    "Revisemos juntos las notas de memoria de este proyecto, una por una: cuáles siguen siendo ciertas, cuáles repiten otra y cuáles quedaron viejas. Proponeme cómo dejar cada una y esperá mi ok antes de cambiarla u olvidarla.",
  "memory.review.draft.global":
    "Revisemos juntos lo que tus notas dicen sobre mí, una por una: cuáles siguen siendo ciertas, cuáles repiten otra y cuáles quedaron viejas. Proponeme cómo dejar cada una y esperá mi ok antes de cambiarla u olvidarla.",
  "memory.review.draft.agent":
    "Revisemos juntos tu cuaderno, nota por nota: cuáles siguen siendo ciertas, cuáles repiten otra y cuáles quedaron viejas. Proponeme cómo dejar cada una y esperá mi ok antes de cambiarla u olvidarla.",
  "memory.review.draft.note":
    "Revisemos esta nota de memoria ({id}): «{text}». ¿Sigue siendo cierta, repite otra, debería decir otra cosa? Proponeme cómo dejarla y esperá mi ok antes de cambiarla u olvidarla.",
};
