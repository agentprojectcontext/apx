import { type Product, text } from "./shared.ts";

export const grokBot: Product = {
  slug: "grok-bot",
  name: "Grok Bot",
  logo: "grok-bot.png",
  source: "https://x.ai/bot",
  detailSource: "https://docs.x.ai/grok-bot/overview",
  license: "https://cursor.com/help/grok-bot/plans",
  sources: [
    { title: "Grok Bot", url: "https://x.ai/bot" },
    { title: "Grok Bot overview", url: "https://docs.x.ai/grok-bot/overview" },
    { title: "Grok Bot get started", url: "https://docs.x.ai/grok-bot/get-started" },
    { title: "Grok Bot computer and apps", url: "https://docs.x.ai/grok-bot/computer-and-apps" },
    { title: "Grok Bot chat and collaboration", url: "https://docs.x.ai/grok-bot/chat-and-collaboration" },
    {
      title: "Grok Bot skills, routines and automations",
      url: "https://docs.x.ai/grok-bot/skills-routines-and-automations",
    },
    { title: "Grok Bot Teams and Enterprise", url: "https://docs.x.ai/grok-bot/teams-and-enterprises" },
    { title: "Grok Bot security", url: "https://docs.x.ai/grok-bot/security" },
    { title: "Grok Bot FAQ", url: "https://docs.x.ai/grok-bot/faq" },
    { title: "Grok Bot plans and billing (Cursor help)", url: "https://cursor.com/help/grok-bot/plans" },
  ],
  rowSources: [
    ["https://docs.x.ai/grok-bot/overview"],
    [
      "https://docs.x.ai/grok-bot/get-started",
      "https://docs.x.ai/grok-bot/faq",
      "https://docs.x.ai/grok-bot/overview",
      "https://docs.x.ai/grok-bot/chat-and-collaboration",
    ],
    [
      "https://docs.x.ai/grok-bot/security",
      "https://docs.x.ai/grok-bot/computer-and-apps",
      "https://docs.x.ai/grok-bot/overview",
    ],
    [
      "https://docs.x.ai/grok-bot/overview",
      "https://docs.x.ai/grok-bot/chat-and-collaboration",
      "https://docs.x.ai/grok-bot/teams-and-enterprises",
    ],
    ["https://docs.x.ai/grok-bot/faq", "https://docs.x.ai/grok-bot/skills-routines-and-automations"],
    [
      "https://docs.x.ai/grok-bot/skills-routines-and-automations",
      "https://docs.x.ai/grok-bot/chat-and-collaboration",
      "https://docs.x.ai/grok-bot/computer-and-apps",
    ],
    ["https://docs.x.ai/grok-bot/faq", "https://docs.x.ai/grok-bot/computer-and-apps"],
    ["https://x.ai/bot", "https://cursor.com/help/grok-bot/plans", "https://docs.x.ai/grok-bot/faq"],
  ],
  short: text("shared cloud computer", "computadora en la nube"),
  tagline: text("Your own hardware or a shared cloud computer?", "¿Tus propios equipos o una computadora en la nube?"),
  intro: text(
    "Both give you several named agents that keep context, hand work to each other and run routines. APX runs them on hardware you control; Grok Bot runs every Bot on one hosted cloud computer for your account.",
    "Ambos te dan varios agentes con nombre que conservan contexto, se pasan trabajo y corren rutinas. APX los corre en equipos que controlás; Grok Bot corre todos tus Bots en una computadora alojada en la nube para tu cuenta.",
  ),
  choice: text(
    "You want hosted Bots that keep working on their own cloud computer while your laptop is closed, with event triggers, team sharing and admin controls.",
    "Querés Bots alojados que sigan trabajando en su propia computadora en la nube con tu laptop cerrada, con disparadores por eventos, Bots compartidos con el equipo y controles de administración.",
  ),
  rows: [
    text(
      "Persistent Bots with names and roles that work through multi-step tasks across apps and websites.",
      "Bots persistentes con nombre y rol que resuelven tareas de varios pasos entre apps y sitios web.",
    ),
    text(
      "Desktop app for macOS, Windows and Linux; iPhone and Android apps; X Chat and tagging @bot on X.",
      "App de escritorio para macOS, Windows y Linux; apps para iPhone y Android; X Chat y etiquetar a @bot en X.",
    ),
    text(
      "A Cursor-operated cloud computer in the US, shared by all your Bots; local commands only if enabled and approved.",
      "Una computadora en la nube operada por Cursor en EE. UU., compartida por todos tus Bots; comandos locales solo si los habilitás y aprobás.",
    ),
    text(
      "Bots run in parallel, message each other and hand off tasks; group chats of two to six Bots; shared team Bots.",
      "Los Bots trabajan en paralelo, se escriben y se pasan tareas; chats grupales de dos a seis Bots; Bots compartidos con el equipo.",
    ),
    text(
      "Each Bot keeps preferences and summaries of past work; skills saved on request or taught by demonstration.",
      "Cada Bot conserva preferencias y resúmenes de trabajo anterior; habilidades que se guardan a pedido o se enseñan con una demostración.",
    ),
    text(
      "Routines on schedules or triggers (Slack, GitHub, email, webhooks); Slack, X Chat and an email address per Bot.",
      "Rutinas programadas o con disparadores (Slack, GitHub, correo, webhooks); Slack, X Chat y una dirección de correo por Bot.",
    ),
    text(
      "Grok Bot picks the model per task, with no model picker; app catalog, browser use and custom MCP servers.",
      "Grok Bot elige el modelo para cada tarea, sin selector de modelos; catálogo de apps, uso del navegador y servidores MCP propios.",
    ),
    text(
      "Proprietary. Included with X Premium ($30/month), Super ($100) and Ultra ($200), Teams and Enterprise; weekly usage, extra billed.",
      "Propietario. Incluido en X Premium (USD 30 al mes), Super (USD 100) y Ultra (USD 200), Teams y Enterprise; uso semanal, el extra se cobra.",
    ),
  ],
  detail: text(
    "Grok Bot and APX both organize work around several named agents with roles, memory, skills and routines. The main difference is where they run: every Bot works on one Cursor-operated cloud computer in the US, while APX agents run on your computer or a server you control. Grok Bot also chooses the model for each task, whereas APX lets you pick model providers, Claude Code, Codex or ACP agents for each agent.",
    "Grok Bot y APX organizan el trabajo con varios agentes con nombre, roles, memoria, habilidades y rutinas. La diferencia principal es dónde corren: todos los Bots trabajan en una computadora en la nube operada por Cursor en EE. UU., mientras que los agentes de APX corren en tu computadora o en un servidor que controlás. Además, Grok Bot elige el modelo para cada tarea, mientras que en APX elegís proveedores de modelos, Claude Code, Codex o agentes ACP para cada agente.",
  ),
  tryIt: text(
    "Give two agents in each product a weekly report that one researches and the other writes up. Check how they hand off, where the files live and what it cost by the end of the week.",
    "Dale a dos agentes de cada producto un informe semanal: uno investiga y el otro lo redacta. Revisá cómo se pasan el trabajo, dónde quedan los archivos y cuánto costó al final de la semana.",
  ),
};
