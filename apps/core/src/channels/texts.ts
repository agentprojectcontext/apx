// What APX itself writes on a channel (not the agent's words), in the owner's language.
import type { Store } from "../domain/store.ts";

const es = {
  pairing: (name: string, agent: string, code: string) =>
    `Hola ${name}. Soy ${agent}, un asistente. Para seguir, mi dueño tiene que aprobar este chat con el código ${code}.`,
  pairingOwner: (name: string, label: string, code: string) =>
    `${name} quiere hablar por ${label}. Código ${code}. Aprobalo acá o en APX › Canales.`,
  approved: "Aprobado.",
  denied: "Rechazado.",
  answered: (a: string) => `Respondido: ${a}`,
  approve: "Permitir",
  deny: "No",
  asContact: "Aprobar como contacto",
  ignore: "Ignorar",
  failed: (why: string) => `No pude terminar: ${why}`,
  contactFailed: "Ahora no puedo responder; ya le avisé a mi dueño.",
  contactFailedOwner: (name: string, why: string) => `No pude responderle a ${name}: ${why}`,
  tooMany: (name: string) => `${name} escribe mucho seguido: pausé sus respuestas automáticas por una hora.`,
  notHandled: (name: string, why: string) => `No pude procesar un mensaje de ${name}: ${why}`,
  buttonFailed: (why: string) => `No pude hacerlo: ${why}`,
};

const en: typeof es = {
  pairing: (name, agent, code) =>
    `Hi ${name}. I'm ${agent}, an assistant. To go on, my owner needs to approve this chat with the code ${code}.`,
  pairingOwner: (name, label, code) =>
    `${name} wants to talk on ${label}. Code ${code}. Approve it here or in APX › Channels.`,
  approved: "Approved.",
  denied: "Denied.",
  answered: (a) => `Answered: ${a}`,
  approve: "Allow",
  deny: "No",
  asContact: "Approve as contact",
  ignore: "Ignore",
  failed: (why) => `I couldn't finish: ${why}`,
  contactFailed: "I can't answer right now; I've let my owner know.",
  contactFailedOwner: (name, why) => `I couldn't answer ${name}: ${why}`,
  tooMany: (name) => `${name} is writing a lot in a row: I paused their automatic answers for an hour.`,
  notHandled: (name, why) => `I couldn't handle a message from ${name}: ${why}`,
  buttonFailed: (why) => `I couldn't do it: ${why}`,
};

export type ChannelTexts = typeof es;

export const channelTexts = (store: Store): ChannelTexts => (store.settings.get("owner_language") === "en" ? en : es);
