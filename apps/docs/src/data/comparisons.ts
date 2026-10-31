import { chatgptDots } from "./compare/chatgpt-dots.ts";
import { claudeCowork } from "./compare/claude-cowork.ts";
import { devin } from "./compare/devin.ts";
import { grokBot } from "./compare/grok-bot.ts";
import { hermesAgent } from "./compare/hermes-agent.ts";
import { instinct } from "./compare/instinct.ts";
import { manus } from "./compare/manus.ts";
import { muse } from "./compare/muse.ts";
import { openbot } from "./compare/openbot.ts";
import { openclaw } from "./compare/openclaw.ts";
import { paperclip } from "./compare/paperclip.ts";
import { type Copy, type Product, text } from "./compare/shared.ts";
import { viktor } from "./compare/viktor.ts";

export type { Lang, Source } from "./compare/shared.ts";
export const checked = "2026-10-30";
export const sourceSnapshots = {
  "agentprojectcontext/apx": "61e82f790c1e4802a8f4e1764ae5ccc86487d3fe",
  "NousResearch/hermes-agent": "5057eaa3a4d0cbef0e30078418a5115faa62889e",
  "openclaw/openclaw": "b277db00687aabbf245c0d9287139a30bb2a22df",
  "paperclipai/paperclip": "76fde891ccc29283b3f5c8dcdce089c5b3d937d1",
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
export const apxSources: { title: Copy; url: string }[] = [
  { title: text("APX on GitHub", "APX en GitHub"), url: apxSource },
  { title: text("APX license", "Licencia de APX"), url: apxLicense },
  { title: text("APX agents", "Agentes de APX"), url: apxDoc("concepts/agents") },
  { title: text("APX tasks", "Tareas de APX"), url: apxDoc("office/tasks") },
  { title: text("APX desktop app", "App de escritorio de APX"), url: apxDoc("devices/desktop") },
  { title: text("APX on your phone", "APX en tu celular"), url: apxDoc("devices/phone") },
  { title: text("APX terminal", "Terminal de APX"), url: apxDoc("reference/cli") },
  { title: text("APX on a server", "APX en un servidor"), url: apxDoc("devices/server") },
  { title: text("APX privacy", "Privacidad de APX"), url: apxDoc("reference/privacy") },
  { title: text("APX memory", "Memoria de APX"), url: apxDoc("concepts/memory") },
  { title: text("APX skills", "Skills de APX"), url: apxDoc("extend/skills") },
  { title: text("APX routines", "Rutinas de APX"), url: apxDoc("office/routines") },
  { title: text("APX channels", "Canales de APX"), url: apxDoc("channels/overview") },
  { title: text("APX models", "Modelos de APX"), url: apxDoc("concepts/models") },
  { title: text("APX and MCP", "APX y MCP"), url: apxDoc("extend/mcp") },
];
export const apxChoice = text(
  "You want an ongoing crew for your projects, with distinct roles, a shared task board and work you can follow in one place.",
  "Querés un equipo estable para tus proyectos, con roles distintos, un tablero de tareas y trabajo que podés seguir en un solo lugar.",
);
export const apxShort = text("project crew", "crew por proyecto");
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
/** The comparisons shown first (the home's cards, the header's menu), most relevant first. */
export const featured = ["claude-cowork", "chatgpt-dots", "openclaw", "manus", "hermes-agent", "openbot"]
  .map((slug) => comparisons.find((c) => c.slug === slug))
  .filter((c): c is Product => c !== undefined);
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
    eyebrow: "Comparison",
    back: "All comparisons",
    sourcesLink: "Sources",
    models: "With the models you already use",
    modelsShort: "Models",
    modelsLead:
      "APX doesn't tie you to one model. Use your plan, an API or a local model, and give each agent the one that suits it.",
    here: "You're here",
    reviewed: "Oct 30, 2026",
    window: "Inbox / Home",
    ask: "Should I use APX or",
    askIndex: "How does APX compare?",
    reply: "It depends on how you work. Here's the short version:",
    replyIndex: "It depends on how you work. Pick one to see the details:",
    checking: "Scout is checking the sources",
    crew: "Meet your crew",
    getApp: "Download APX v2",
    tableHint: "Scroll the table to compare both products.",
    progress: "Reading progress",
    roundup: "Best AI agent apps",
    roundupLead:
      "17 apps compared: crews, hosted assistants and coding agents, with where they run, which models they use and what they cost.",
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
    eyebrow: "Comparativa",
    back: "Todas las comparativas",
    sourcesLink: "Fuentes",
    models: "Con los modelos que ya usás",
    modelsShort: "Modelos",
    modelsLead:
      "APX no te ata a un modelo. Usá tu plan, una API o un modelo local, y dale a cada agente el que mejor le sirve.",
    here: "Estás acá",
    reviewed: "30 oct 2026",
    window: "Bandeja / Home",
    ask: "¿Me conviene APX o",
    askIndex: "¿Cómo se compara APX?",
    reply: "Depende de cómo trabajás. Te lo resumo:",
    replyIndex: "Depende de cómo trabajás. Elegí una para ver los detalles:",
    checking: "Scout está revisando las fuentes",
    crew: "Conocé a tu crew",
    getApp: "Bajar APX v2",
    tableHint: "Desplazá la tabla para comparar ambos productos.",
    progress: "Progreso de lectura",
    roundup: "Las mejores apps de agentes",
    roundupLead:
      "17 apps comparadas: equipos, asistentes alojados y agentes de código, con dónde corren, qué modelos usan y cuánto cuestan.",
  },
};

/** The ways to bring a model into APX, as concepts/models.mdx lists them. `mark` is a brand's own mark. */
export const modelTiles: {
  name: Copy;
  about: Copy;
  mark?: "openai" | "claude" | "gemini" | "codex" | "ollama";
  icon?: "bot" | "link";
}[] = [
  { name: text("ChatGPT", "ChatGPT"), about: text("Your ChatGPT plan.", "Tu plan de ChatGPT."), mark: "openai" },
  {
    name: text("Claude", "Claude"),
    about: text("Anthropic's API, with your key.", "La API de Anthropic, con tu clave."),
    mark: "claude",
  },
  {
    name: text("Gemini", "Gemini"),
    about: text("Google's Gemini API.", "La API de Gemini de Google."),
    mark: "gemini",
  },
  {
    name: text("Claude Code", "Claude Code"),
    about: text("Its sessions sit beside your chats.", "Sus sesiones quedan al lado de tus chats."),
    mark: "claude",
  },
  {
    name: text("Codex", "Codex"),
    about: text("Its sessions sit beside your chats.", "Sus sesiones quedan al lado de tus chats."),
    mark: "codex",
  },
  {
    name: text("ACP agents", "Agentes ACP"),
    about: text("OpenCode, Qwen Code, goose and more.", "OpenCode, Qwen Code, goose y más."),
    icon: "bot",
  },
  {
    name: text("OpenAI-compatible APIs", "APIs compatibles con OpenAI"),
    about: text("Anything that speaks that API.", "Todo lo que hable esa API."),
    icon: "link",
  },
  {
    name: text("Local models", "Modelos locales"),
    about: text("Ollama or LM Studio, with no key.", "Ollama o LM Studio, sin clave."),
    mark: "ollama",
  },
];
