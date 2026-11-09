import type { enActivityReview } from "./activity-review-en.ts";

export const esActivityReview: Record<keyof typeof enActivityReview, string> = {
  "review.title": "Revisión y mejoras",
  "review.lead": "APX revisa la actividad y te propone mejoras para que decidas cuáles hacer.",
  "review.enabled": "Revisar actividad",
  "review.cost": "Puede consumir créditos o uso de tu plan. Si no hay actividad nueva, no hace una revisión.",
  "review.frequency": "Frecuencia",
  "review.interval": "Cada 24 horas o cada 7 días mientras APX está abierto. Las revisiones pendientes no se acumulan.",
  "review.daily": "Diaria",
  "review.weekly": "Semanal",
  "review.details": "Detalles extra",
  "review.detailsHint": "Opcional. Indicá qué te gustaría que tenga en cuenta.",
  "review.proposalOnly":
    "Solo se consideran conversaciones recientes con vos, no contactos privados ni salas. Las propuestas aparecen en Tareas para aceptar o descartar. No se aplica nada automáticamente.",
  "review.unavailable":
    "Las revisiones están pausadas hasta que haya un modelo auxiliar disponible. Se conserva tu configuración.",
  "review.save": "Guardar cambios",
  "review.saved": "Cambios guardados.",
  "review.conflict":
    "Esta configuración cambió en otro lugar. Volvé a cargarla antes de guardar. Al hacerlo, se reemplazan tus cambios sin guardar.",
  "review.reload": "Volver a cargar configuración",
  "review.retry": "Intentar de nuevo",
  "review.loadError": "No se pudo cargar la configuración. Intentá de nuevo.",
  "review.saveError": "No se pudieron guardar los cambios. Intentá de nuevo.",
};
