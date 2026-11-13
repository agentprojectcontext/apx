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
  "group.add": "Sumar un agente",
  "group.remove": "Sacar a {name}",
  "group.ownModel": "Su propio modelo",
  "group.resetModel": "Volver a su propio modelo",
  "group.allModel": "Mismo modelo para todos",
  "group.allModelPick": "Elegir un modelo",
  "group.router": "Quién responde lo elige",
  "group.routerAux": "El modelo auxiliar",
  "group.routerHint": "No se usa cuando nombrás a alguien, con o sin @.",
  "group.resetRouter": "Volver al modelo auxiliar",
};
