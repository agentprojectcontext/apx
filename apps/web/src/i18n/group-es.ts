// Spanish of group-en.ts.
import type { enGroup } from "./group-en.ts";

export const esGroup: Record<keyof typeof enGroup, string> = {
  "group.newBody":
    "Elegí de dos a cinco agentes. Cuando escribas, responden aquellos a quienes va tu mensaje, uno después del otro. Nombrá a alguien, con o sin @, para preguntarle.",
  "group.name": "Nombre",
  "group.nameHint": "Opcional. Sin nombre, el grupo lleva el de sus miembros.",
  "group.members": "Miembros",
  "group.picked": "{count} de 5",
  "group.search": "Buscar agentes",
  "group.noAgents": "Ningún agente coincide.",
  "group.create": "Crear grupo",
  "group.card": "Grupo",
  "group.cardHint": "Quién está en el grupo y con qué modelo responde cada uno acá",
  "group.remove": "Sacar a {name}",
  "group.resetModel": "Volver a su propio modelo",
  "group.resetRouter": "Volver al modelo auxiliar",
  "group.models": "Modelos",
  "group.sameModel": "Mismo modelo para todos",
  "group.sameModelHint": "Apagado: cada agente responde con su propio modelo, o con el que le elijas acá.",
  "group.modelOf": "Modelo de {name}",
  "group.ownSuffix": "{model} · el suyo",
  "group.routerModel": "Modelo que elige quién responde",
  "group.routerHelpLabel": "Sobre el modelo que elige quién responde",
  "group.routerHelp":
    "Antes de cada mensaje tuyo, este modelo lo lee y elige qué agentes responden, casi siempre uno. No se usa cuando nombrás a alguien, con o sin @. Uno rápido evita que el grupo se quede esperando.",
  "group.auxSuffix": "{model} · auxiliar",
  "group.addMember": "Sumar un agente",
};
