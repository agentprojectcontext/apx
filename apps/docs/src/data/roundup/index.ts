import { text } from "../compare/shared.ts";
import { codingApps } from "./coding.ts";
import { hostedApps } from "./hosted.ts";
import { personalApps } from "./personal.ts";

// "Best AI agent apps": every cell is backed by the app's `sources`. See COMPARISONS.md.
export const roundupChecked = "2026-10-30";
export const roundupTitle = text(
  "Best AI agent apps in 2026: 17 apps compared",
  "Las mejores apps de agentes de IA en 2026: 17 apps comparadas",
);
export const roundupIntro = text(
  "Agent apps now range from crews on your own computer to hosted assistants and coding agents. Here are 17, grouped by kind, with what each is for, where it runs, which models it uses and what it costs, all from official pages.",
  "Hoy las apps de agentes van desde equipos en tu propia computadora hasta asistentes alojados y agentes de código. Acá hay 17, agrupadas por tipo, con para qué sirve cada una, dónde corre, qué modelos usa y cuánto cuesta, todo sacado de páginas oficiales.",
);
export const roundupShort = text(
  "If you want a crew with roles and a task board on hardware you control, try APX; for one assistant across your chat apps, OpenClaw or Hermes Agent. If you'd rather not install anything, the hosted assistants fit: Claude Cowork or ChatGPT dots if you already pay for Claude or ChatGPT, Manus for finished deliverables, Grok Bot or Viktor for teams. For code, Claude Code, Codex, Cursor, Antigravity and Devin are built for it, and APX can run Claude Code and Codex for its agents.",
  "Si querés un equipo con roles y un tablero de tareas en equipos que controlás, probá APX; para un asistente en tus apps de chat, OpenClaw o Hermes Agent. Si preferís no instalar nada, te sirven los asistentes alojados: Claude Cowork o ChatGPT dots si ya pagás Claude o ChatGPT, Manus para entregables terminados, Grok Bot o Viktor para equipos. Para programar están Claude Code, Codex, Cursor, Antigravity y Devin, y APX puede usar Claude Code y Codex para sus agentes.",
);
export const roundupGroups = [
  { id: "apx", title: text("APX", "APX") },
  { id: "crews", title: text("Crews and personal agents", "Equipos y agentes personales") },
  { id: "hosted", title: text("Hosted assistants", "Asistentes alojados") },
  { id: "coding", title: text("Coding agents", "Agentes de código") },
] as const;

export const roundupApps = [...personalApps, ...hostedApps, ...codingApps];

/** Read from the source page on `date`; scores rounded as the page shows them. */
export const roundupBenchmark = {
  source: {
    title: "Artificial Analysis Coding Agent Index",
    url: "https://artificialanalysis.ai/agents/coding-agents",
  },
  methodology: {
    title: "Artificial Analysis coding agents methodology",
    url: "https://artificialanalysis.ai/methodology/coding-agents-benchmarking",
  },
  publisher: {
    title: "About Artificial Analysis",
    url: "https://artificialanalysis.ai/about",
  },
  index: "Coding Agent Index v2.0 (FrontierCode v1.1, Terminal-Bench 4.0, SWE-Atlas-QnA-AA, equal weights)",
  date: "2026-10-30",
  rows: [
    {
      app: "claude-code",
      agent: "Claude Code - Claude Opus 5.5 (Max, Default Fallback)",
      score: 62,
      costUsd: 11.42,
      minutes: 61,
    },
    {
      app: "devin",
      agent: "Devin Fusion CLI - Claude Opus 5.5 Max + GPT-6 Luna High",
      score: 62,
      costUsd: 8.0,
      minutes: 51,
    },
    {
      app: "codex",
      agent: "Codex - GPT-6 Astra (Max)",
      score: 55,
      costUsd: 7.04,
      minutes: 25,
    },
    {
      app: "codex",
      agent: "Codex - GPT-6.1 Sol (Max)",
      score: 54,
      costUsd: 1.5,
      minutes: 24,
    },
    {
      app: "antigravity",
      agent: "Antigravity CLI - Gemini 4 Argon (High)",
      score: 53,
      costUsd: 11.73,
      minutes: 35,
    },
  ],
  caveats: {
    en: "Coding agents only: APX, Cursor and the other apps here are not in the index. Cost is pay-per-token API pricing, not a plan price; scores are averages across three public benchmarks and the index changes between versions.",
    es: "Solo agentes de código: APX, Cursor y las demás apps de esta página no están en el índice. El costo es por tokens de API, no el precio de un plan; los puntajes promedian tres pruebas públicas y el índice cambia entre versiones.",
  },
};
export const roundupBenchmarkColumns = {
  agent: {
    en: "Agent and model",
    es: "Agente y modelo",
  },
  score: {
    en: "Index score (higher is better)",
    es: "Puntaje del índice (más es mejor)",
  },
  cost: {
    en: "API cost per task (lower is better)",
    es: "Costo de API por tarea (menos es mejor)",
  },
  time: {
    en: "Time per task (lower is better)",
    es: "Tiempo por tarea (menos es mejor)",
  },
};
export const roundupFaq = [
  {
    q: text("Which one runs on my own computer?", "¿Cuál corre en mi propia computadora?"),
    a: text(
      "APX, OpenClaw, Hermes Agent, OpenBot and Paperclip run on your computer or a server you control. Claude Code, Codex, Cursor, Antigravity and Devin's Desktop and CLI work locally too, with cloud models. Claude Cowork, ChatGPT dots, Manus, Grok Bot, Viktor, Muse and Instinct run on their vendor's cloud; some can reach your computer if you allow it.",
      "APX, OpenClaw, Hermes Agent, OpenBot y Paperclip corren en tu computadora o en un servidor que controlás. Claude Code, Codex, Cursor, Antigravity y Devin Desktop y su CLI también trabajan en local, con modelos en la nube. Claude Cowork, ChatGPT dots, Manus, Grok Bot, Viktor, Muse e Instinct corren en la nube de cada empresa; algunos pueden llegar a tu computadora si lo permitís.",
    ),
    sources: [
      "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/devices/server.mdx",
      "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/README.md",
      "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/README.md",
      "https://openbot.run/compare/hermes-agent",
      "https://paperclip.ing/llms.txt",
      "https://code.claude.com/docs/en/overview",
      "https://learn.chatgpt.com/docs",
      "https://cursor.com/docs/cloud-agent",
      "https://antigravity.google/docs/remote-control",
      "https://docs.devin.ai/work-with-devin/devin-cli",
      "https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview",
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://help.manus.im/en/articles/15392111-what-is-the-cloud-computer",
      "https://docs.x.ai/grok-bot/security",
      "https://viktor.com/security",
      "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
      "https://instinct.com/terms",
    ],
  },
  {
    q: text("Which one can use my ChatGPT or Claude plan?", "¿Cuál puede usar mi plan de ChatGPT o de Claude?"),
    a: text(
      "Codex is included in ChatGPT plans from Free up, and ChatGPT dots comes with Pro. Claude Code is included from Claude Pro, and Claude Cowork needs a paid Claude plan. APX can use your ChatGPT plan and run Claude Code and Codex as harnesses, so their plans keep working inside APX; OpenBot and Paperclip also drive Claude Code and Codex, and Devin can link a ChatGPT plan.",
      "Codex viene incluido en los planes de ChatGPT desde Free, y ChatGPT dots viene con Pro. Claude Code está incluido desde Claude Pro, y Claude Cowork necesita un plan pago de Claude. APX puede usar tu plan de ChatGPT y correr Claude Code y Codex como motores, así que esos planes siguen sirviendo dentro de APX; OpenBot y Paperclip también manejan Claude Code y Codex, y Devin puede vincular un plan de ChatGPT.",
    ),
    sources: [
      "https://learn.chatgpt.com/docs/pricing",
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://claude.com/pricing",
      "https://claude.com/pricing",
      "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/concepts/models.mdx",
      "https://openbot.run/compare/hermes-agent",
      "https://paperclip.ing/llms.txt",
      "https://docs.devin.ai/admin/billing/chatgpt",
    ],
  },
  {
    q: text("Which one is free?", "¿Cuál es gratis?"),
    a: text(
      "APX, OpenClaw, Hermes Agent and Paperclip are free under the MIT license; you pay your model provider separately. OpenBot's license allows noncommercial use. Codex (in ChatGPT Free), Cursor, Antigravity, Devin, Manus, Viktor and Muse have free tiers with limits. Claude Code, Claude Cowork, ChatGPT dots and Grok Bot need a paid plan.",
      "APX, OpenClaw, Hermes Agent y Paperclip son gratis bajo licencia MIT; al proveedor de modelos le pagás aparte. La licencia de OpenBot permite el uso no comercial. Codex (en ChatGPT Free), Cursor, Antigravity, Devin, Manus, Viktor y Muse tienen planes gratis con límites. Claude Code, Claude Cowork, ChatGPT dots y Grok Bot necesitan un plan pago.",
    ),
    sources: [
      "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/LICENSE",
      "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/LICENSE",
      "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
      "https://github.com/paperclipai/paperclip/blob/76fde891ccc29283b3f5c8dcdce089c5b3d937d1/LICENSE",
      "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
      "https://learn.chatgpt.com/docs/pricing",
      "https://cursor.com/docs/models-and-pricing",
      "https://antigravity.google/pricing",
      "https://devin.ai/pricing",
      "https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus",
      "https://viktor.com/pricing",
      "https://www.meta.com/help/subscriptions/1021145227643680/",
      "https://claude.com/pricing",
      "https://claude.com/pricing",
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://x.ai/bot",
    ],
  },
  {
    q: text("Which one is best for writing code?", "¿Cuál conviene para programar?"),
    a: text(
      "Claude Code, Codex, Cursor, Google Antigravity and Devin are built for code. Pick by the models and plan you already have and where you want the agent: terminal, editor or cloud. In the Artificial Analysis Coding Agent Index read on October 30, 2026, the best Claude Code and Devin configurations scored highest among the apps here, and Codex had the lowest cost per task; Cursor is not in that index.",
      "Claude Code, Codex, Cursor, Google Antigravity y Devin están hechos para programar. Elegí según los modelos y el plan que ya tenés y dónde querés al agente: terminal, editor o nube. En el Coding Agent Index de Artificial Analysis, consultado el 30 de octubre de 2026, las mejores configuraciones de Claude Code y Devin sacaron los puntajes más altos entre estas apps, y Codex tuvo el menor costo por tarea; Cursor no está en ese índice.",
    ),
    sources: [
      "https://code.claude.com/docs/en/overview",
      "https://learn.chatgpt.com/docs",
      "https://cursor.com/",
      "https://antigravity.google/docs/overview",
      "https://devin.ai/",
      "https://artificialanalysis.ai/agents/coding-agents",
    ],
  },
  {
    q: text("Can I use more than one together?", "¿Puedo usar más de uno a la vez?"),
    a: text(
      "Yes. APX can run Claude Code, Codex and ACP agents as harnesses for its own agents, so a crew can code with the tool you already pay for. Paperclip and OpenBot also drive coding agents, and Devin Desktop can run ACP agents.",
      "Sí. APX puede correr Claude Code, Codex y agentes ACP como motores de sus propios agentes, así un equipo programa con la herramienta que ya pagás. Paperclip y OpenBot también manejan agentes de código, y Devin Desktop puede correr agentes ACP.",
    ),
    sources: [
      "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/concepts/models.mdx",
      "https://paperclip.ing/llms.txt",
      "https://openbot.run/compare/hermes-agent",
      "https://docs.devin.ai/desktop/acp",
    ],
  },
];
