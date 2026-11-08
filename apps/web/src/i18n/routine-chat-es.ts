import type { MessageKey } from "./en.ts";

// Las ejecuciones de una rutina como un solo chat: su encabezado, la línea entre ejecuciones y la línea de tiempo.
export const esRoutineChat: Partial<Record<MessageKey, string>> = {
  "routineChat.earlierRuns": "{n} ejecuciones anteriores",
  "routineChat.laterRuns": "{n} ejecuciones posteriores",
  "routineChat.placeholder": "Escribile a {name} sobre esta rutina…",
  "routineChat.sub": "Rutina · {schedule} · {runs}",
  "routineChat.runsOne": "1 ejecución",
  "routineChat.runsMany": "{n} ejecuciones",
  "routineChat.paused": "Pausada",
  "routineChat.timeline": "Ejecuciones",
  "routineChat.changed": "Instrucciones actualizadas",
  "routineChat.earlier": "Versión anterior",
  "routineChat.notFound.title": "Esta rutina ya no está",
  "routineChat.notFound.body": "Puede que la hayan borrado. Elegí otra de la lista.",
  "routineChat.empty.title": "Todavía no corrió",
  "routineChat.empty.body": "Cada vez que corra, lo que hizo aparece acá, una ejecución tras otra.",
};
