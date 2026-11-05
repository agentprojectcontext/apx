import type { NewsEntry } from "./entries.ts";

// Settings › Move or back up and `apx export` / `apx import` (DECISIONS.md#d-192).
export const MOVE_BACKUP_NEWS: NewsEntry = {
  id: "move-backup",
  since: "2.13.0",
  title: { en: "Move APX to another computer", es: "Llevá APX a otra computadora" },
  about: {
    en: "Settings › Move or back up downloads your agents, projects, routines, Flows, memory and settings as one file, without keys or passwords. On the other computer you see what it brings before importing it.",
    es: "Configuración › Mover o respaldar descarga tus agentes, proyectos, rutinas, Flows, memoria y ajustes en un archivo, sin claves ni contraseñas. En la otra computadora ves qué trae antes de importarlo.",
  },
  applies: () => true,
  text:
    "Settings, Move or back up (and `apx export` / `apx import` in the terminal) saves the owner's setup as one " +
    "file: agents with their prompts, models and skills, projects' APX settings, routines, Flows with their tables " +
    "(rows and chats only when the owner ticks them), memory notes, channels, MCP servers, model providers and " +
    "preferences. No key, token or password goes in it: each stays a variable name. Importing shows first what is " +
    "added, changed or left out; MCP servers, channels and Flows arrive off, and the owner adds the listed keys in " +
    "Variables and turns each one on. The same file twice changes nothing. Only the owner exports or imports, from " +
    "Settings or the terminal; agents cannot.",
  actions: [
    {
      label: { en: "How do I move it?", es: "¿Cómo la llevo?" },
      prompt: "Tell me in a few lines how I take my APX to another computer, and what I must do there after importing.",
    },
  ],
};
