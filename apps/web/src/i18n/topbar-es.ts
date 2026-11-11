import type { MessageKey } from "./en.ts";

// Barra superior: la campanita de notificaciones y el menú de lo que está trabajando ahora.
export const esTopbar: Partial<Record<MessageKey, string>> = {
  "topbar.notifications": "Notificaciones",
  "topbar.work.processes": "Procesos",
  "topbar.work.seeAll": "Ver todo en Tareas",
  "topbar.work.openProcesses": "Abrir los procesos de este chat",
};
