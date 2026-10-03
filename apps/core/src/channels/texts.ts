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
  answering: (name: string, label: string) => `${name} te escribió por ${label}: le contesto como contacto nuevo.`,
  answer: "Contestarle",
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
  routine: (name: string, text: string) => `**${name}**\n\n${text}`,
  due: (title: string, person?: string, owedBy?: "owner" | "person") =>
    person
      ? owedBy === "person"
        ? `Vence: ${title}. Te lo debe ${person}.`
        : `Vence: ${title}. Se lo debés a ${person}.`
      : `Vence: ${title}.`,
  routineFailed: (name: string, why: string) => `La rutina «${name}» no pudo terminar: ${why}`,
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
  answer: "Answer them",
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
  routine: (name, text) => `**${name}**\n\n${text}`,
  due: (title, person, owedBy) =>
    person
      ? owedBy === "person"
        ? `Due: ${title}. ${person} owes it to you.`
        : `Due: ${title}. You owe it to ${person}.`
      : `Due: ${title}.`,
  routineFailed: (name, why) => `The routine "${name}" couldn't finish: ${why}`,
};

export type ChannelTexts = typeof es;

export const channelTexts = (store: Store): ChannelTexts => (store.settings.get("owner_language") === "en" ? en : es);
