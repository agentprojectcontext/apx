// What APX itself writes on a channel (not the agent's words), in the owner's language.
import type { Store } from "../domain/store.ts";

const es = {
  pairing: (name: string, agent: string, code: string, label: string) =>
    `Hola ${name}. Soy ${agent}, un asistente. Todavía no conozco este chat: hay que aprobarlo con el código ${code}. Si sos mi dueño, en APX › ${label} tocá "Soy yo" y escribilo.`,
  pairingOwner: (name: string, label: string, code: string) =>
    `${name} quiere hablar por ${label}. Código ${code}. Aprobalo acá o en APX › Canales.`,
  pairingApp: (name: string, label: string, code: string) =>
    `${name} quiere hablar por ${label} (código ${code}). Aprobalo en la lista de ${label}.`,
  askOwner: (name: string, label: string, text: string) =>
    `${name} te escribió por ${label}${text ? `: «${text}»` : "."} ¿Le contesto?`,
  wroteFirst: (name: string, label: string, text: string) =>
    `${name} te escribió por ${label}${text ? `: «${text}»` : "."} No le contesto: quedó como contacto sin revisar.`,
  answering: (name: string, label: string) => `${name} te escribió por ${label}: le contesto como contacto nuevo.`,
  answer: "Contestarle",
  willAnswer: (name: string) => `Listo: a partir de ahora le contesto a ${name}.`,
  keptQuiet: (name: string) => `Listo: ${name} queda silenciado y no te aviso más de sus mensajes.`,
  approved: "Aprobado.",
  denied: "Rechazado.",
  answered: (a: string) => `Respondido: ${a}`,
  approve: "Permitir",
  deny: "No",
  send: "Enviar",
  skip: "Omitir",
  skipped: "(omitida)",
  pickSome: "Tildá al menos una opción, o tocá Omitir.",
  cut: (more: number) => `(cortado: ${more} caracteres más, miralos en APX antes de aprobar)`,
  asContact: "Aprobar como contacto",
  ignore: "Ignorar",
  failed: (why: string) => `No pude terminar: ${why}`,
  contactFailed: "Ahora no puedo responder; ya le avisé a mi dueño.",
  contactFailedOwner: (name: string, why: string) => `No pude responderle a ${name}: ${why}`,
  reactFailed: (emoji: string, where: string) =>
    `No pude reaccionar con ${emoji} en ${where}: no hay un mensaje suyo al que reaccionar o el canal no lo permite. No se envió nada.`,
  tooMany: (name: string) => `${name} escribe mucho seguido: pausé sus respuestas automáticas por una hora.`,
  roomCap: (room: string) =>
    `Llegué al tope de respuestas por hora en ${room}: sigo leyendo, contesto cuando se libere.`,
  roomFailed: (room: string, why: string) => `No pude responder en ${room}: ${why}`,
  notHandled: (name: string, why: string) => `No pude procesar un mensaje de ${name}: ${why}`,
  buttonFailed: (why: string) => `No pude hacerlo: ${why}`,
  stopped: "Listo, paré.",
  due: (title: string, person?: string, owedBy?: "owner" | "person") =>
    person
      ? owedBy === "person"
        ? `Vence: ${title}. Te lo debe ${person}.`
        : `Vence: ${title}. Se lo debés a ${person}.`
      : `Vence: ${title}.`,
  routineFailed: (name: string, why: string) => `La rutina «${name}» no pudo terminar: ${why}`,
  providerLimitTitle: "Límite del proveedor de modelos",
  providerLimit: (until?: string) =>
    until
      ? `El proveedor de modelos llegó a su límite de uso: los agentes quedan frenados hasta las ${until}.`
      : "El proveedor de modelos llegó a su límite de uso: los agentes quedan frenados y no dijo hasta cuándo.",
  noticeLostTitle: "Un aviso no te llegó",
  noticeLost: (channels: string, why: string, text: string) =>
    `Ningún canal pudo entregarlo (${channels}${why ? `: ${why}` : ""}). Decía: «${text}»`,
  reminders: (lines: string[]) => `Recordatorios:\n${lines.map((l) => `• ${l}`).join("\n")}`,
  digest: (texts: string[]) => `Mientras estabas en silencio:\n\n${texts.join("\n\n—\n\n")}`,
  suggested: (name: string, label: string, said: string, draft: string) =>
    `${name} te escribió por ${label}:\n${said}\n\nLe contestaría:\n«${draft}»`,
  noSuggestion: (name: string, label: string, said: string, why: string) =>
    `${name} te escribió por ${label}:\n${said}\n\nNo te sugiero respuesta: ${why}`,
  nothingToAnswer: "parece que no hace falta contestar.",
  quote: (text: string) => `«${text}»`,
  sendThis: "Mandar esta",
  writeMyself: "Contestar yo",
  suggestionSent: (name: string) => `Listo: se lo mandé a ${name}.`,
  suggestionNotSent: (name: string, why: string) => `No le llegó a ${name}: ${why}`,
  suggestionDropped: (name: string) => `Listo: no le contesto a ${name}.`,
  suggestionGone: "Esa sugerencia ya no está pendiente (ya se decidió o llegó un mensaje más nuevo).",
  inputGone: "Eso ya no está pendiente: se respondió en otro lado o venció.",
  writeNow: (name: string, minutes: number) =>
    `Escribí tu respuesta para ${name}: lo próximo que me mandes acá se lo envío tal cual (durante ${minutes} minutos). Mandá «cancelar» para no enviarle nada.`,
  writeCanceled: "Listo, no le mando nada.",
  tooManyDrafts: (name: string) =>
    `${name} escribe mucho seguido: por esta hora no te sugiero más respuestas. Sus mensajes quedan en su chat.`,
};

const en: typeof es = {
  pairing: (name, agent, code, label) =>
    `Hi ${name}. I'm ${agent}, an assistant. I don't know this chat yet: it has to be approved with the code ${code}. If you are my owner, tap "It's me" in APX › ${label} and type it.`,
  pairingOwner: (name, label, code) =>
    `${name} wants to talk on ${label}. Code ${code}. Approve it here or in APX › Channels.`,
  pairingApp: (name, label, code) =>
    `${name} wants to talk on ${label} (code ${code}). Approve it in the ${label} list.`,
  askOwner: (name, label, text) => `${name} wrote to you on ${label}${text ? `: "${text}"` : "."} Shall I answer?`,
  answering: (name, label) => `${name} wrote to you on ${label}: I'm answering them as a new contact.`,
  wroteFirst: (name, label, text) =>
    `${name} wrote to you on ${label}${text ? `: "${text}"` : "."} I'm not answering: they're kept as an unreviewed contact.`,
  answer: "Answer them",
  willAnswer: (name) => `Done: from now on I answer ${name}.`,
  keptQuiet: (name) => `Done: ${name} stays silenced and I won't report their messages anymore.`,
  approved: "Approved.",
  denied: "Denied.",
  answered: (a) => `Answered: ${a}`,
  approve: "Allow",
  deny: "No",
  send: "Send",
  skip: "Skip",
  skipped: "(skipped)",
  pickSome: "Tick at least one option, or tap Skip.",
  cut: (more) => `(cut: ${more} more characters, see them in APX before approving)`,
  asContact: "Approve as contact",
  ignore: "Ignore",
  failed: (why) => `I couldn't finish: ${why}`,
  contactFailed: "I can't answer right now; I've let my owner know.",
  contactFailedOwner: (name, why) => `I couldn't answer ${name}: ${why}`,
  reactFailed: (emoji, where) =>
    `I couldn't react with ${emoji} in ${where}: there is no message of theirs to react to, or the channel does not allow it. Nothing was sent.`,
  tooMany: (name) => `${name} is writing a lot in a row: I paused their automatic answers for an hour.`,
  roomCap: (room) => `I hit the hourly cap of answers in ${room}: I keep reading and answer once it frees up.`,
  roomFailed: (room, why) => `I couldn't answer in ${room}: ${why}`,
  notHandled: (name, why) => `I couldn't handle a message from ${name}: ${why}`,
  buttonFailed: (why) => `I couldn't do it: ${why}`,
  stopped: "Done, I stopped.",
  due: (title, person, owedBy) =>
    person
      ? owedBy === "person"
        ? `Due: ${title}. ${person} owes it to you.`
        : `Due: ${title}. You owe it to ${person}.`
      : `Due: ${title}.`,
  routineFailed: (name, why) => `The routine "${name}" couldn't finish: ${why}`,
  providerLimitTitle: "Model provider limit",
  providerLimit: (until) =>
    until
      ? `The model provider's usage limit was reached: agents are stopped until ${until}.`
      : "The model provider's usage limit was reached: agents are stopped, and it did not say until when.",
  noticeLostTitle: "A notice didn't reach you",
  noticeLost: (channels, why, text) =>
    `No channel could deliver it (${channels}${why ? `: ${why}` : ""}). It said: "${text}"`,
  reminders: (lines) => `Reminders:\n${lines.map((l) => `• ${l}`).join("\n")}`,
  digest: (texts) => `While your quiet hours lasted:\n\n${texts.join("\n\n—\n\n")}`,
  suggested: (name, label, said, draft) => `${name} wrote to you on ${label}:\n${said}\n\nI'd answer:\n"${draft}"`,
  noSuggestion: (name, label, said, why) => `${name} wrote to you on ${label}:\n${said}\n\nNo suggested answer: ${why}`,
  nothingToAnswer: "it seems to need no answer.",
  quote: (text) => `"${text}"`,
  sendThis: "Send this",
  writeMyself: "I'll answer",
  suggestionSent: (name) => `Done: sent to ${name}.`,
  suggestionNotSent: (name, why) => `It didn't reach ${name}: ${why}`,
  suggestionDropped: (name) => `Done: I won't answer ${name}.`,
  suggestionGone: "That suggestion is no longer pending (it was decided, or a newer message came in).",
  inputGone: "That is no longer pending: it was answered elsewhere or it expired.",
  writeNow: (name, minutes) =>
    `Write your answer for ${name}: the next thing you send me here goes to them as it is (for ${minutes} minutes). Send "cancel" to send nothing.`,
  writeCanceled: "Done, I'm sending nothing.",
  tooManyDrafts: (name) =>
    `${name} is writing a lot in a row: no more suggested answers this hour. Their messages stay in their chat.`,
};

export type ChannelTexts = typeof es;

export const channelTexts = (store: Store): ChannelTexts => (store.settings.get("owner_language") === "en" ? en : es);
