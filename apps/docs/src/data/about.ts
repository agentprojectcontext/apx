// The About page's words, in English and Spanish (rioplatense). The first line is the shared definition.
import { DEFINITION } from "./brand";

const en = {
  nav: "About APX",
  title: "About APX",
  lead: DEFINITION.en,
  facts: "At a glance",
  rows: [
    [
      "What it is",
      "A desktop app and a local service for your own AI agents: a super-agent that answers you anywhere and a crew per project.",
    ],
    ["Runs on", "macOS, Windows, Linux and Android, or on a server you own."],
    ["License", "Free and open source, MIT license."],
    ["Works with", "Claude Code, Codex and any model API: Claude, ChatGPT, Gemini, Ollama and more."],
    ["Talks through", "Telegram, WhatsApp, Discord, Slack and iMessage."],
    ["Memory", "Plain files in your projects, following the open APC standard (AGENTS.md and .apc/)."],
    ["Made in", "Argentina."],
  ],
  name: "The name",
  nameText:
    "APX is the app of the Agent Project Context (APC) project. It is a separate thing from other products called APX, such as a programming school, a pistol line or a crypto token.",
  find: "Find APX",
  download: "Download APX",
  docs: "Read the guide",
  description:
    "APX is a free, open-source desktop app that runs your own team of AI agents on your machine. What it is, where it runs and where to find it.",
};

export type AboutText = typeof en;

const es: AboutText = {
  nav: "Sobre APX",
  title: "Sobre APX",
  lead: DEFINITION.es,
  facts: "En resumen",
  rows: [
    [
      "Qué es",
      "Una app de escritorio y un servicio local para tus propios agentes de IA: un super-agente que te responde en cualquier lado y una crew por proyecto.",
    ],
    ["Dónde corre", "macOS, Windows, Linux y Android, o en un servidor tuyo."],
    ["Licencia", "Gratis y open source, licencia MIT."],
    ["Funciona con", "Claude Code, Codex y la API de cualquier modelo: Claude, ChatGPT, Gemini, Ollama y más."],
    ["Habla por", "Telegram, WhatsApp, Discord, Slack e iMessage."],
    ["Memoria", "Archivos de texto en tus proyectos, con el estándar abierto APC (AGENTS.md y .apc/)."],
    ["Hecho en", "Argentina."],
  ],
  name: "El nombre",
  nameText:
    "APX es la app del proyecto Agent Project Context (APC). No tiene relación con otros productos llamados APX, como una escuela de programación, una línea de pistolas o un token cripto.",
  find: "Dónde encontrar APX",
  download: "Descargar APX",
  docs: "Leer la guía",
  description:
    "APX es una app de escritorio gratis y open source para tener tu propio equipo de agentes de IA en tu máquina. Qué es, dónde corre y dónde encontrarla.",
};

export const ABOUT = { en, es } as const;
