// What the core's notices say, in each language the apps speak: one copy for the web and the phone. A notice carries a
// stable `code` (and `vars`); its `text` is the core's English, kept when there is no translation or it carries details.

export const noticeEn = {
  "notice.run.stepLimit":
    "Ran out of steps for this turn: this is a report of what is done and left, not a final answer.",
  "notice.run.noModel": "No model available: none of the models could answer (out of quota, signed out or down).",
  "notice.run.noModel.limit": "Stopped by the model provider's usage limit, which lifts at {until}.",
  "notice.run.noModel.limitUnknown": "Stopped by the model provider's usage limit (it did not say when it lifts).",
  "notice.routine.shell": "Ran the command.",
  "notice.routine.watch.quiet": "Nothing new to watch: the model was not called.",
  "notice.routine.relay.quiet": "No team news to tell: the model was not called.",
  "notice.routine.pre.ok": "Pre-command: ok",
  "notice.routine.pre.failed": "Pre-command: failed (exit {exit})",
  "notice.routine.pre.timeout": "Pre-command: timed out",
  "notice.routine.post.ok": "Post-command: ok",
  "notice.routine.post.failed": "Post-command: failed (exit {exit})",
  "notice.routine.post.timeout": "Post-command: timed out",
  "notice.routine.skipped": "The model was not called; the pre-command's result did not ask for it.",
  "notice.breaker.paused.runs":
    "Paused: agents started {spent} turns on their own since you last wrote here. {who} finished; write to continue.",
  "notice.breaker.paused.tokens":
    "Paused: agents spent {spent} tokens on their own since you last wrote here. {who} finished; write to continue.",
  "notice.breaker.paused.link": "Change the limit",
  "notice.breaker.held.runs":
    "Paused: agents started {spent} turns on their own since you last wrote here. {who} starts “{task}” once you let them go on.",
  "notice.breaker.held.tokens":
    "Paused: agents spent {spent} tokens on their own since you last wrote here. {who} starts “{task}” once you let them go on.",
  "notice.breaker.held.agentRuns":
    "Paused for {who}: {who} started {spent} turns on its own since you last wrote here, its own limit. It starts “{task}” once you let them go on.",
  "notice.breaker.held.agentTokens":
    "Paused for {who}: {who} spent {spent} tokens on its own since you last wrote here, its own limit. It starts “{task}” once you let them go on.",
  "notice.breaker.held.link": "Change the limit",
  "notice.breaker.reset": "Restart the budget",
  "notice.breaker.release": "Let them finish this round",
  "notice.breaker.wentOn": "Agents went on",
  "notice.delegation.limit.continuedSteps":
    "{who} ran out of steps on “{task}” and is making progress; APX had it go on in session {session}. So far: {sofar}",
  "notice.delegation.limit.continuedTime":
    "{who} ran out of time on “{task}” and is making progress; APX had it go on in session {session}. So far: {sofar}",
  "notice.delegation.limit.stoppedSteps":
    "{who} ran out of steps on “{task}” and its last part made no progress, so APX did not go on by itself. Continue if it should. So far: {sofar}",
  "notice.delegation.limit.stoppedTime":
    "{who} ran out of time on “{task}” and its last part made no progress, so APX did not go on by itself. Continue if it should. So far: {sofar}",
  "notice.delegation.limit.returnedSteps":
    "{who} ran out of steps on “{task}”. {caller} has its report and decides how to go on. So far: {sofar}",
  "notice.delegation.limit.returnedTime":
    "{who} ran out of time on “{task}”. {caller} has its report and decides how to go on. So far: {sofar}",
  "notice.delegation.limit.open": "Open session",
  "notice.delegation.limit.loading": "Checking session…",
  "notice.delegation.limit.working": "Still working",
  "notice.delegation.limit.queued": "Queued",
  "notice.delegation.limit.waiting": "Waiting for your answer",
  "notice.delegation.limit.completed": "Finished",
  "notice.delegation.limit.continue": "Continue",
  "notice.delegation.limit.continuing": "Continuing…",
  "notice.delegation.limit.offline": "Offline: current session status unavailable",
  "notice.delegation.limit.unavailable": "Could not check session status",
  "notice.delegation.limit.continuePrompt":
    "Continue the remaining work in this session from the last progress report. Keep the existing scope and permissions; report the result to the original caller.",
  "notice.delegation.limit.stop": "Stop it",
  "notice.delegation.limit.stopped": "Stopped",
  "notice.delegation.limit.ended": "It had already ended",
  "notice.delegation.continued": "APX continued this session after a limit stopped it.",
  "notice.run.interrupted": "Interrupted by a restart of APX.",
  "notice.run.resumed": "Interrupted by a restart of APX; picking it back up.",
  "notice.run.canceled": "Canceled.",
  "notice.run.failed": "Could not finish.",
  "notice.run.empty": "Finished without a message.",
  "notice.harness.fallback": "The chosen engine was not available; answered with the built-in model.",
  "notice.info": "Note",
  "notice.warn": "Warning",
  "notice.engine.fallback": "{model} did not answer ({why}); went on with {to}.",
  "notice.engine.fallback.title": "Switched model",
  "notice.thread.compacted":
    "Earlier turns were summarized to keep this chat's context small. Nothing new was started.",
  "notice.task.stalled": "Nothing was running on this task: APX asked the agent to go on or say what it waits for.",
  "notice.pairing.request": "Someone new wants to talk on a channel: approve them in Settings → Channels.",
};

export type NoticeKey = keyof typeof noticeEn;

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
  "notice.run.empty": "Terminó sin mensaje.",
  "notice.harness.fallback": "El motor elegido no estaba disponible; respondió el modelo propio.",
  "notice.info": "Nota",
  "notice.warn": "Aviso",
  "notice.engine.fallback": "{model} no respondió ({why}); siguió con {to}.",
  "notice.engine.fallback.title": "Cambió de modelo",
  "notice.thread.compacted":
    "Se resumieron los turnos anteriores para que el contexto de este chat sea más chico. No se empezó nada nuevo.",
  "notice.task.stalled": "No había nada corriendo en esta tarea: APX le pidió al agente que siga o diga qué espera.",
  "notice.pairing.request": "Alguien nuevo quiere hablar por un canal: aprobalo en Configuración › Canales.",
};

const NOTICES = { en: noticeEn, es: noticeEs } as const;

const fill = (text: string, vars: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** The key a notice reads from: its code, and the wording its `variant` picks (`notice.<code>.<variant>`). */
export const noticeKey = (part: { code: string; vars?: Record<string, string | number> | undefined }) =>
  `notice.${part.code}${part.vars?.variant ? `.${part.vars.variant}` : ""}`;

/**
 * A notice in `lang`: the translation when there is one and the notice is the plain case (it has vars, or its English
 * carries no details after a colon), else the core's own text.
 */
export function noticeText(
  part: { code: string; text: string; vars?: Record<string, string | number> | undefined },
  lang: keyof typeof NOTICES,
): string {
  const key = noticeKey(part);
  if (!Object.hasOwn(noticeEn, key) || (!part.vars && part.text.includes(":"))) return part.text;
  return fill(NOTICES[lang][key as NoticeKey], part.vars);
}

/**
 * The chat app the owner picked for notices, as every app shows it: "auto" (the first that knows them), a channel's id,
 * or "none" (the app and paired phones only). A phone picked before every phone was told is "none" (DECISIONS.md#d-161).
 */
export const noticeChannelChoice = (channel: string | undefined): string =>
  !channel ? "auto" : channel === "none" || channel.startsWith("device:") ? "none" : channel;
