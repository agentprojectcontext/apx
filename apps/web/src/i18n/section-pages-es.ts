import type { MessageKey } from "./en.ts";

// Páginas de sección (Tareas, Flows, Rutinas, Archivos, Computadoras, Recursos, Canales): su cabecera común, la lista
// de computadoras y dónde está activo un recurso en cada proyecto.
export const esSectionPages: Partial<Record<MessageKey, string>> = {
  "section.scope.all": "Todos",
  "section.scope.allHint": "Ver todo, de todos los proyectos",
  "section.scope.onlyHint": "Ver solo {name}",
  "section.tasks.newHint": "Escribirle una tarea a un agente",
  "section.flows.newHint": "Dibujar un flow nuevo desde cero",
  "section.routines.newHint": "Programar algo que un agente hace con horario",
  "section.channels.newHint": "Conectar una cuenta de mensajería",
  "section.res.addHint": "Agregar uno a esta lista",
  "machines.lead": "Máquinas donde trabajan tus agentes. Para usar una vos, tomá el control.",
  "machines.here": "Esta computadora",
  "machines.vm": "Computadora Linux aislada",
  "machines.usedBy": "{names} la está usando",
  "machines.free": "Libre",
  "machines.off": "Apagada",
  "machines.starting": "Encendiendo",
  "machines.notLent": "No se la prestás a los agentes",
  "machines.setUp": "Configurar",
  "machines.setUpHint": "Dejar que los agentes usen esta computadora desde la app de escritorio",
  "machines.settings": "Ajustes",
  "machines.settingsHint": "Cambiar lo que los agentes pueden hacer en esta computadora",
  "machines.startHint": "Encender la computadora Linux para que trabajen los agentes permitidos",
  "machines.stopHint": "Apagarla para todos los agentes; su disco se guarda",
  "res.kind.skill": "Skill",
  "res.kind.mcp": "MCP",
  "res.onLabel": "Activa",
  "res.offLabel": "Apagada",
  "res.byProject": "Por proyecto",
  "res.originNote": "origen",
  "res.inheritedNote": "heredada",
  "res.onInProject": "{resource} activa en {name}",
  "res.subprojectsNote":
    "Los subproyectos heredan lo que tenga activo su proyecto. Podés apagarlo en uno sin tocar el original.",
};
