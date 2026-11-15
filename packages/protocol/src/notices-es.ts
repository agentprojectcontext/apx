import type { NoticeKey } from "./notices-en.ts";

export const noticeEs: Record<NoticeKey, string> = {
  "notice.run.stepLimit":
    "Se quedó sin pasos en este turno: es un informe de lo hecho y lo que falta, no una respuesta final.",
  "notice.run.noModel": "Sin modelo disponible: ninguno de los modelos pudo responder (sin cupo, sin sesión o caído).",
  "notice.run.noModel.limit": "Frenado por el límite de uso del proveedor de modelos, que se libera a las {until}.",
  "notice.run.noModel.limitUnknown":
    "Frenado por el límite de uso del proveedor de modelos (no dijo cuándo se libera).",
  "notice.routine.shell": "Corrió el comando.",
  "notice.routine.watch.quiet": "Nada nuevo que vigilar: no se llamó al modelo.",
  "notice.routine.relay.quiet": "No hay novedades del equipo: no se llamó al modelo.",
  "notice.routine.pre.ok": "Comando previo: ok",
  "notice.routine.pre.failed": "Comando previo: falló (código {exit})",
  "notice.routine.pre.timeout": "Comando previo: se cortó por tiempo",
  "notice.routine.post.ok": "Comando posterior: ok",
  "notice.routine.post.failed": "Comando posterior: falló (código {exit})",
  "notice.routine.post.timeout": "Comando posterior: se cortó por tiempo",
  "notice.routine.skipped": "No se llamó al modelo; el resultado del comando previo no lo pedía.",
  "notice.breaker.paused.runs":
    "En pausa: los agentes hicieron {spent} turnos solos desde tu último mensaje acá. {who} terminó; escribí para seguir.",
  "notice.breaker.paused.tokens":
    "En pausa: los agentes gastaron {spent} tokens solos desde tu último mensaje acá. {who} terminó; escribí para seguir.",
  "notice.breaker.paused.link": "Cambiar el límite",
  "notice.breaker.held.runs":
    "En pausa: los agentes hicieron {spent} turnos solos desde tu último mensaje acá. {who} empieza «{task}» cuando los dejes seguir.",
  "notice.breaker.held.tokens":
    "En pausa: los agentes gastaron {spent} tokens solos desde tu último mensaje acá. {who} empieza «{task}» cuando los dejes seguir.",
  "notice.breaker.held.agentRuns":
    "En pausa para {who}: {who} hizo {spent} turnos solo desde tu último mensaje acá, su propio límite. Empieza «{task}» cuando los dejes seguir.",
  "notice.breaker.held.agentTokens":
    "En pausa para {who}: {who} gastó {spent} tokens solo desde tu último mensaje acá, su propio límite. Empieza «{task}» cuando los dejes seguir.",
  "notice.breaker.held.link": "Cambiar el límite",
  "notice.breaker.paused.progressRuns":
    "En pausa: los agentes hicieron {spent} turnos en «{stuck}» sin terminar un paso de su plan. {who} terminó; escribí para seguir.",
  "notice.breaker.paused.progressTokens":
    "En pausa: los agentes gastaron {spent} tokens en «{stuck}» sin terminar un paso de su plan. {who} terminó; escribí para seguir.",
  "notice.breaker.held.progressRuns":
    "En pausa: los agentes hicieron {spent} turnos en «{stuck}» sin terminar un paso de su plan. {who} empieza «{task}» cuando los dejes seguir.",
  "notice.breaker.held.progressTokens":
    "En pausa: los agentes gastaron {spent} tokens en «{stuck}» sin terminar un paso de su plan. {who} empieza «{task}» cuando los dejes seguir.",
  "notice.breaker.reset": "Reiniciar presupuesto",
  "notice.breaker.release": "Liberar en esta ronda",
  "notice.breaker.wentOn": "Los agentes siguieron",
  "notice.delegation.limit.continuedSteps":
    "{who} se quedó sin pasos con «{task}» y viene avanzando; APX lo hizo seguir en la sesión {session}. Hasta ahora: {sofar}",
  "notice.delegation.limit.continuedTime":
    "{who} se quedó sin tiempo con «{task}» y viene avanzando; APX lo hizo seguir en la sesión {session}. Hasta ahora: {sofar}",
  "notice.delegation.limit.stoppedSteps":
    "{who} se quedó sin pasos con «{task}» y su último tramo no avanzó, así que APX no siguió solo. Tocá Continuar si tiene que seguir. Hasta ahora: {sofar}",
  "notice.delegation.limit.stoppedTime":
    "{who} se quedó sin tiempo con «{task}» y su último tramo no avanzó, así que APX no siguió solo. Tocá Continuar si tiene que seguir. Hasta ahora: {sofar}",
  "notice.delegation.limit.returnedSteps":
    "{who} se quedó sin pasos con «{task}». {caller} tiene su informe y decide cómo seguir. Hasta ahora: {sofar}",
  "notice.delegation.limit.returnedTime":
    "{who} se quedó sin tiempo con «{task}». {caller} tiene su informe y decide cómo seguir. Hasta ahora: {sofar}",
  "notice.delegation.limit.open": "Abrir sesión",
  "notice.delegation.limit.loading": "Consultando sesión…",
  "notice.delegation.limit.working": "Sigue trabajando",
  "notice.delegation.limit.queued": "En cola",
  "notice.delegation.limit.waiting": "Esperando tu respuesta",
  "notice.delegation.limit.completed": "Terminó",
  "notice.delegation.limit.continue": "Continuar",
  "notice.delegation.limit.continuing": "Continuando…",
  "notice.delegation.limit.offline": "Sin conexión: estado actual no disponible",
  "notice.delegation.limit.unavailable": "No pude consultar estado de sesión",
  "notice.delegation.limit.continuePrompt":
    "Continuá el trabajo pendiente en esta sesión desde el último informe. Conservá el alcance y los permisos existentes; informá el resultado a quien te delegó.",
  "notice.delegation.limit.stop": "Detenerla",
  "notice.delegation.limit.stopped": "Detenida",
  "notice.delegation.limit.ended": "Ya había terminado",
  "notice.delegation.continued": "APX siguió esta sesión después de que un límite la detuviera.",
  "notice.run.interrupted": "Se interrumpió por un reinicio de APX.",
  "notice.run.resumed": "Se interrumpió por un reinicio de APX; lo retomo.",
  "notice.run.canceled": "Cancelado.",
  "notice.run.failed": "No pude terminar.",
  "notice.run.failed.network": "No se pudo llegar al proveedor del modelo: sin conexión.",
  "notice.run.failed.timeout": "Tardó demasiado y se detuvo.",
  "notice.run.failed.limit": "Se alcanzó el límite de uso del proveedor del modelo.",
  "notice.run.failed.signed_out": "El proveedor del modelo pide volver a iniciar sesión.",
  "notice.run.failed.refused": "El proveedor del modelo rechazó el pedido.",
  "notice.run.failed.down": "El proveedor del modelo no responde o está saturado.",
  "notice.run.failed.restart": "APX se reinició mientras corría.",
  "notice.run.empty": "Terminó sin mensaje.",
  "notice.harness.fallback": "El motor elegido no estaba disponible; respondió el modelo propio.",
  "notice.info": "Nota",
  "notice.warn": "Aviso",
  "notice.engine.fallback": "{model} no respondió ({why}); siguió con {to}.",
  "notice.engine.fallback.title": "Cambió de modelo",
  "notice.thread.compacted":
    "Se resumieron los turnos anteriores para que el contexto de este chat sea más chico. No se empezó nada nuevo.",
  "notice.task.stalled": "No había nada corriendo en esta tarea: APX le pidió al agente que siga o diga qué espera.",
  "notice.pairing.request": "Alguien nuevo quiere hablar por un canal: aprobalo en Canales.",
};
