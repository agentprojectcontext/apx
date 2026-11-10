import type { MessageKey } from "./en.ts";

// La tarjeta de un chat (de un contacto, un grupo o una sala), el menú de clic derecho de la cuenta y los filtros de Canales.
export const esChannelsSlim: Partial<Record<MessageKey, string>> = {
  "ch.rel.lead": "Lead",
  "ch.relation.hint": "Qué es de vos: cambia cómo le habla el agente",
  "ch.relation.clear": "Otro clic lo quita",
  "ch.who.placeholder": "Ej.: dueño de la panadería del centro",
  "ch.rules.placeholder": "Ej.: no pasarle precios sin consultarme",
  "ch.answers": "Atiende",
  "ch.answers.account": "Como la cuenta · {agent}",
  "ch.answers.other": "Otro agente",
  "ch.answers.pick": "Agente que le contesta a {name}",
  "ch.answers.otherHint": "Este agente le contesta a {name} en todas las cuentas.",
  "ch.card.group": "Grupo",
  "ch.card.room": "Sala",
  "ch.card.via": "{app} · {account}",
  "room.card.speaks": "Cuándo habla en la sala",
  "room.card.speaksGroup": "Cuándo habla en el grupo",
  "room.card.rulesPlaceholder": "Ej.: no publicar precios en la sala",
  "room.card.rulesHint":
    "Para todas las salas de {account}. Van al final del prompt, así que le ganan a la cautela del agente.",
  "room.card.gone": "Esta sala ya no está en la lista de la cuenta: el agente no lee ni contesta acá.",
  "room.card.addAgain": "Abrir las salas de la cuenta",
  "room.card.saveHint": "Guardar cuándo habla acá y las reglas",
  "ch.saved.room": "Guardado.",
  "chs.menu.edit": "Editar cuenta…",
  "chs.menu.contacts": "Contactos…",
  "chs.menu.quiet": "Silenciar avisos",
  "chs.menu.unquiet": "Volver a avisarme",
  "chs.menu.disconnect": "Desconectar",
  "chs.filter.all": "Ver todas las cuentas",
  "chs.filter.kind": "Ver solo las cuentas de {app}",
};
