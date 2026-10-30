import { chatgptDots } from "./compare/chatgpt-dots";
import { claudeCowork } from "./compare/claude-cowork";
import { devin } from "./compare/devin";
import { grokBot } from "./compare/grok-bot";
import { hermesAgent } from "./compare/hermes-agent";
import { instinct } from "./compare/instinct";
import { manus } from "./compare/manus";
import { muse } from "./compare/muse";
import { openbot } from "./compare/openbot";
import { openclaw } from "./compare/openclaw";
import { paperclip } from "./compare/paperclip";
import { type Product, text } from "./compare/shared";
import { viktor } from "./compare/viktor";

export type { Lang, Source } from "./compare/shared";
export const checked = "2026-10-30";
export const sourceSnapshots = {
  "agentprojectcontext/apx": "61e82f790c1e4802a8f4e1764ae5ccc86487d3fe",
  "NousResearch/hermes-agent": "5057eaa3a4d0cbef0e30078418a5115faa62889e",
  "openclaw/openclaw": "b277db00687aabbf245c0d9287139a30bb2a22df",
  "nightly-labs/openbot": "98e89b61782a2ae7d0aac380d82d824b65179afd",
} as const;
export const apxSource = "https://github.com/agentprojectcontext/apx";
const apxDoc = (path: string) =>
  `${apxSource}/blob/${sourceSnapshots["agentprojectcontext/apx"]}/apps/docs/src/content/docs/${path}.mdx`;
const apxLicense = `${apxSource}/blob/${sourceSnapshots["agentprojectcontext/apx"]}/LICENSE`;
export const apxRowSources = [
  [apxDoc("concepts/agents"), apxDoc("office/tasks")],
  [apxDoc("devices/desktop"), apxDoc("devices/phone"), apxDoc("reference/cli")],
  [apxDoc("devices/server"), apxDoc("reference/privacy")],
  [apxDoc("concepts/agents"), apxDoc("office/tasks")],
  [apxDoc("concepts/memory"), apxDoc("extend/skills")],
  [apxDoc("office/routines"), apxDoc("channels/overview")],
  [apxDoc("concepts/models"), apxDoc("extend/mcp"), apxDoc("extend/skills")],
  [apxLicense, apxDoc("concepts/models")],
];
export const apxSources: { title: string; url: string }[] = [
  { title: "APX on GitHub", url: apxSource },
  { title: "APX license", url: apxLicense },
  { title: "APX agents", url: apxDoc("concepts/agents") },
  { title: "APX tasks", url: apxDoc("office/tasks") },
  { title: "APX desktop app", url: apxDoc("devices/desktop") },
  { title: "APX on your phone", url: apxDoc("devices/phone") },
  { title: "APX terminal", url: apxDoc("reference/cli") },
  { title: "APX on a server", url: apxDoc("devices/server") },
  { title: "APX privacy", url: apxDoc("reference/privacy") },
  { title: "APX memory", url: apxDoc("concepts/memory") },
  { title: "APX skills", url: apxDoc("extend/skills") },
  { title: "APX routines", url: apxDoc("office/routines") },
  { title: "APX channels", url: apxDoc("channels/overview") },
  { title: "APX models", url: apxDoc("concepts/models") },
  { title: "APX and MCP", url: apxDoc("extend/mcp") },
];
export const apxChoice = text(
  "You want an ongoing crew for your projects, with distinct roles, a shared task board and work you can follow in one place.",
  "Querés un equipo estable para tus proyectos, con roles distintos, un tablero de tareas y trabajo que podés seguir en un solo lugar.",
);
export const apxRows = [
  text(
    "A team organized around projects, roles and tracked tasks.",
    "Un equipo organizado por proyectos, roles y tareas con seguimiento.",
  ),
  text(
    "Desktop app for macOS, Windows and Linux; Android app, web panel and terminal.",
    "App de escritorio para macOS, Windows y Linux; app Android, panel web y terminal.",
  ),
  text(
    "Your computer or a server you control. Model providers receive the prompts you send.",
    "Tu computadora o un servidor que controlás. Los proveedores de modelos reciben los mensajes que les enviás.",
  ),
  text(
    "Agents hand off work; tasks keep their status, discussion and results.",
    "Los agentes se reparten trabajo; las tareas conservan su estado, conversación y resultados.",
  ),
  text(
    "Persistent memory, project context and reusable skills.",
    "Memoria persistente, contexto de proyecto y habilidades reutilizables.",
  ),
  text(
    "Scheduled routines and connected chat channels, including Telegram and Discord.",
    "Rutinas programadas y canales de chat conectados, como Telegram y Discord.",
  ),
  text(
    "Model providers, Claude Code, Codex and ACP agents; MCP and skills.",
    "Proveedores de modelos, Claude Code, Codex y agentes ACP; MCP y habilidades.",
  ),
  text(
    "MIT. Model and service usage can have separate costs.",
    "MIT. El uso de modelos y servicios puede tener costos aparte.",
  ),
];
export const topics = [
  text("Main focus", "Enfoque principal"),
  text("How you use it", "Cómo lo usás"),
  text("Where work runs", "Dónde se ejecuta"),
  text("Working together", "Trabajo en equipo"),
  text("Context over time", "Contexto a lo largo del tiempo"),
  text("Recurring work and chats", "Trabajo recurrente y chats"),
  text("Models and extensions", "Modelos y extensiones"),
  text("License and costs", "Licencia y costos"),
];
export const comparisons: Product[] = [
  hermesAgent,
  openclaw,
  openbot,
  claudeCowork,
  chatgptDots,
  manus,
  devin,
  paperclip,
  viktor,
  grokBot,
  muse,
  instinct,
];
export type Comparison = Product;
export const labels = {
  en: {
    comparisons: "Comparisons",
    docs: "Docs",
    skip: "Skip to content",
    kicker: "Find your kind of crew",
    title: "Compare APX with your next AI agent",
    intro: "Different tools, different ways to work. Start with what you need, then check the sources.",
    short: "The short answer",
    choose: "Choose",
    if: "if…",
    glance: "At a glance",
    topic: "What matters",
    details: "What makes the difference",
    trial: "Try it on real work",
    sources: "Sources and scope",
    more: "Keep comparing",
    read: "On this page",
    checked: "Sources checked October 30, 2026",
    note: "Written by APX, using the primary sources below. This is a documented-feature comparison, not a hands-on benchmark or a security audit. Features, plans and terms can change. A missing detail is not a missing feature.",
    official: "Official project",
    terms: "License",
    start: "Meet your crew",
    source: "Source",
    trademarks: "Product names and logos belong to their respective owners. No affiliation or endorsement is implied.",
    home: "Home",
  },
  es: {
    comparisons: "Comparativas",
    docs: "Guías",
    skip: "Ir al contenido",
    kicker: "Encontrá tu tipo de equipo",
    title: "Compará APX con tu próximo agente de IA",
    intro: "Distintas herramientas, distintas formas de trabajar. Partí de lo que necesitás y revisá las fuentes.",
    short: "La respuesta breve",
    choose: "Elegí",
    if: "si…",
    glance: "De un vistazo",
    topic: "Lo que importa",
    details: "Qué marca la diferencia",
    trial: "Probalo con trabajo real",
    sources: "Fuentes y alcance",
    more: "Seguí comparando",
    read: "En esta página",
    checked: "Fuentes revisadas el 30 de octubre de 2026",
    note: "Escrito por APX con las fuentes primarias de abajo. Compara capacidades documentadas: no es una prueba de rendimiento ni una auditoría de seguridad. Las funciones, los planes y los términos pueden cambiar. Un detalle no mencionado no es una función ausente.",
    official: "Proyecto oficial",
    terms: "Licencia",
    start: "Conocé a tu equipo",
    source: "Fuente",
    trademarks: "Los nombres y logos pertenecen a sus respectivos dueños. No implican afiliación ni respaldo.",
    home: "Inicio",
  },
};
