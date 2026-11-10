import type { MessageKey } from "./en.ts";

// Herramientas del panel lateral: los agentes que llamó un chat, los comandos que corrió su agente y tus terminales.
export const esPanelAgents: Partial<Record<MessageKey, string>> = {
  "panel.agents": "Agentes del chat",
  "panel.agents.hint": "Agentes del chat: los agentes a los que este chat les pidió ayuda y lo que hicieron",
  "panel.procs.hint": "Procesos del chat: los comandos que corrió el agente acá y lo que mostraron",
  "panel.term.hint": "Terminal: tus propias terminales en la carpeta de este chat",
  "agentsPanel.empty": "Este chat todavía no llamó a otros agentes",
  "agentsPanel.failed": "No se pudieron cargar los agentes del chat",
  "agentsPanel.going": "En curso",
  "procs.empty": "El agente no corrió comandos en este chat",
  "procs.emptyBody": "Cuando corra uno (en primer plano o en segundo plano) lo vas a ver acá con lo que mostró.",
  "procs.noneActive": "Nada corriendo ahora.",
  "procs.noneDone": "Todavía no terminó ningún comando.",
  "procs.failed": "No se pudieron cargar los procesos del chat",
  "procs.list": "Comandos",
  "procs.noOutput": "No mostró nada.",
  "procs.loadingOutput": "Cargando la salida…",
  "terminal.none": "No hay terminales abiertas",
  "terminal.noneBody": "Una terminal es tu propia consola en la carpeta de este chat, para correr comandos vos mismo.",
};
