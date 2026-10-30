import { text } from "../compare/shared.ts";

export const personalApps = [
  {
    slug: "apx",
    name: "APX",
    group: "apx",
    logo: null,
    comparePage: null,
    bestFor: text("An ongoing crew for your projects", "Un equipo estable para tus proyectos"),
    runsOn: text(
      "Your computer or server; desktop, Android, web, terminal",
      "Tu compu o servidor; escritorio, Android, web, terminal",
    ),
    models: text(
      "Your ChatGPT plan, APIs, Claude Code, Codex, ACP, local",
      "Tu plan de ChatGPT, APIs, Claude Code, Codex, ACP, locales",
    ),
    price: text(
      "Free, MIT. Model and service usage can cost extra.",
      "Gratis, MIT. El uso de modelos y servicios puede costar aparte.",
    ),
    summary: text(
      "A local agent office: a team of named agents organized by projects, roles and a shared task board, with persistent memory, skills, scheduled routines and chat channels such as Telegram and Discord. It runs on your computer or a server you control and works with model providers, local models and coding agents such as Claude Code and Codex.",
      "Una oficina de agentes local: un equipo de agentes con nombre organizado por proyectos, roles y un tablero de tareas compartido, con memoria persistente, habilidades, rutinas programadas y canales de chat como Telegram y Discord. Corre en tu computadora o en un servidor que controlás y trabaja con proveedores de modelos, modelos locales y agentes de código como Claude Code y Codex.",
    ),
    chooseIf: text(
      "You want a crew with distinct roles and a task board, on hardware you control.",
      "Querés un equipo con roles distintos y un tablero de tareas, en equipos que controlás.",
    ),
    sources: [
      { title: "APX on GitHub", url: "https://github.com/agentprojectcontext/apx" },
      {
        title: "APX license",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/LICENSE",
      },
      {
        title: "APX agents",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/concepts/agents.mdx",
      },
      {
        title: "APX tasks",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/office/tasks.mdx",
      },
      {
        title: "APX desktop app",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/devices/desktop.mdx",
      },
      {
        title: "APX on your phone",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/devices/phone.mdx",
      },
      {
        title: "APX terminal",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/reference/cli.mdx",
      },
      {
        title: "APX on a server",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/devices/server.mdx",
      },
      {
        title: "APX privacy",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/reference/privacy.mdx",
      },
      {
        title: "APX memory",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/concepts/memory.mdx",
      },
      {
        title: "APX skills",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/extend/skills.mdx",
      },
      {
        title: "APX routines",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/office/routines.mdx",
      },
      {
        title: "APX channels",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/channels/overview.mdx",
      },
      {
        title: "APX models",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/concepts/models.mdx",
      },
      {
        title: "APX and MCP",
        url: "https://github.com/agentprojectcontext/apx/blob/61e82f790c1e4802a8f4e1764ae5ccc86487d3fe/apps/docs/src/content/docs/extend/mcp.mdx",
      },
    ],
  },
  {
    slug: "openclaw",
    name: "OpenClaw",
    group: "crews",
    logo: "openclaw.svg",
    comparePage: "openclaw",
    bestFor: text("A personal assistant across your chat apps", "Un asistente personal en tus apps de chat"),
    runsOn: text(
      "Your own hardware; control UI, terminal, desktop and mobile apps",
      "Tu propio equipo; panel, terminal, apps de escritorio y móvil",
    ),
    models: text(
      "Hosted and local providers; swappable model plugins",
      "Proveedores alojados y locales; plugins de modelo intercambiables",
    ),
    price: text(
      "Free, MIT. Model and service usage can cost extra.",
      "Gratis, MIT. El uso de modelos y servicios puede costar aparte.",
    ),
    summary: text(
      "An open-source personal assistant that lives across your devices and a broad catalog of chat channels, including WhatsApp and Telegram. It has workspace memory, skills, scheduled jobs and multi-agent routing, and runs on your own hardware.",
      "Un asistente personal de código abierto que vive en tus dispositivos y en un catálogo amplio de canales de chat, como WhatsApp y Telegram. Tiene memoria de espacio de trabajo, habilidades, tareas programadas y ruteo entre varios agentes, y corre en tu propio equipo.",
    ),
    chooseIf: text(
      "You want one assistant reachable from many chat apps, with a large plugin ecosystem.",
      "Querés un asistente al que llegás desde muchas apps de chat, con un ecosistema grande de plugins.",
    ),
    sources: [
      { title: "OpenClaw on GitHub", url: "https://github.com/openclaw/openclaw" },
      {
        title: "OpenClaw README",
        url: "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/README.md",
      },
      { title: "OpenClaw multi-agent routing", url: "https://docs.openclaw.ai/concepts/multi-agent" },
      { title: "OpenClaw cron jobs", url: "https://docs.openclaw.ai/automation/cron-jobs" },
      {
        title: "OpenClaw license",
        url: "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/LICENSE",
      },
    ],
  },
  {
    slug: "hermes-agent",
    name: "Hermes Agent",
    group: "crews",
    logo: "hermes.png",
    comparePage: "hermes-agent",
    bestFor: text("An assistant that improves its own skills", "Un asistente que mejora sus propias habilidades"),
    runsOn: text(
      "Your computer or a server; terminal UI, desktop app",
      "Tu compu o un servidor; terminal y app de escritorio",
    ),
    models: text(
      "Multiple model providers; MCP, skills and plugins",
      "Varios proveedores de modelos; MCP, habilidades y plugins",
    ),
    price: text(
      "Free, MIT. Providers and hosted execution can cost extra.",
      "Gratis, MIT. Proveedores y ejecución alojada pueden costar aparte.",
    ),
    summary: text(
      "An open-source assistant built around a skill-learning loop: it curates memory, searches past conversations and refines its skills as you use it. It has a terminal UI, a desktop app, built-in cron and a messaging gateway for Telegram, Discord, Slack and more.",
      "Un asistente de código abierto armado alrededor de un ciclo de aprendizaje de habilidades: cura su memoria, busca en conversaciones anteriores y mejora sus habilidades con el uso. Tiene interfaz de terminal, app de escritorio, cron integrado y conexión a Telegram, Discord, Slack y más.",
    ),
    chooseIf: text(
      "You want one assistant that learns skills from experience, reachable from your chat apps.",
      "Querés un asistente que aprenda habilidades con la experiencia y que puedas usar desde tus apps de chat.",
    ),
    sources: [
      { title: "Hermes Agent on GitHub", url: "https://github.com/NousResearch/hermes-agent" },
      {
        title: "Hermes Agent README",
        url: "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/README.md",
      },
      {
        title: "Hermes Agent license",
        url: "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
      },
    ],
  },
  {
    slug: "openbot",
    name: "OpenBot",
    group: "crews",
    logo: "openbot.png",
    comparePage: "openbot",
    bestFor: text("Persistent AI teammates on your desktop", "Compañeros de IA persistentes en tu escritorio"),
    runsOn: text(
      "Desktop app for macOS, Windows, Linux; mobile companions",
      "App de escritorio para macOS, Windows, Linux; apps móviles",
    ),
    models: text(
      "Codex, Claude Code, ACP agents, compatible and local endpoints",
      "Codex, Claude Code, agentes ACP, endpoints compatibles y locales",
    ),
    price: text(
      "Source available under PolyForm Noncommercial; provider costs separate.",
      "Código disponible bajo PolyForm Noncommercial; proveedores aparte.",
    ),
    summary: text(
      "A desktop app for persistent AI teammates with their own instructions and workspaces, stored on your computer. Agents message each other and hand off tasks, with scheduled routines and channels such as Slack, Discord and Telegram.",
      "Una app de escritorio para compañeros de IA persistentes, con sus propias instrucciones y espacios de trabajo guardados en tu computadora. Los agentes se escriben, se pasan tareas y tienen rutinas programadas y canales como Slack, Discord y Telegram.",
    ),
    chooseIf: text(
      "You prefer its teammate workspaces and its noncommercial license fits your use.",
      "Preferís sus espacios de trabajo por compañero y su licencia no comercial te sirve para tu uso.",
    ),
    sources: [
      { title: "OpenBot", url: "https://openbot.run/" },
      { title: "OpenBot compared with Hermes Agent", url: "https://openbot.run/compare/hermes-agent" },
      {
        title: "OpenBot license",
        url: "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
      },
    ],
  },
  {
    slug: "paperclip",
    name: "Paperclip",
    group: "crews",
    logo: "paperclip.png",
    comparePage: "paperclip",
    bestFor: text("Running agents as a company with governance", "Manejar agentes como una empresa, con control"),
    runsOn: text(
      "Self-hosted web dashboard on your laptop, Docker or server",
      "Panel web autoalojado en tu compu, Docker o servidor",
    ),
    models: text("Claude Code, Codex, Gemini CLI, OpenCode and more", "Claude Code, Codex, Gemini CLI, OpenCode y más"),
    price: text(
      "Free, MIT. Agent and model usage can cost extra.",
      "Gratis, MIT. El uso de agentes y modelos puede costar aparte.",
    ),
    summary: text(
      "An open-source orchestrator that runs a team of agents as a company, with goals, an org chart, tasks, budgets and approvals. It is self-hosted, drives coding agents such as Claude Code and Codex, and has heartbeats and routines on schedules or triggers.",
      "Un orquestador de código abierto que maneja un equipo de agentes como una empresa, con objetivos, organigrama, tareas, presupuestos y aprobaciones. Es autoalojado, dirige agentes de código como Claude Code y Codex, y tiene latidos y rutinas por horario o disparadores.",
    ),
    chooseIf: text(
      "You want business goals run through an org chart of agents, with budgets and approval gates.",
      "Querés llevar objetivos de negocio con un organigrama de agentes, presupuestos y aprobaciones.",
    ),
    sources: [
      { title: "Paperclip home page", url: "https://paperclip.ing/" },
      { title: "Paperclip llms.txt overview", url: "https://paperclip.ing/llms.txt" },
      { title: "Paperclip README", url: "https://github.com/paperclipai/paperclip" },
      {
        title: "Paperclip license",
        url: "https://github.com/paperclipai/paperclip/blob/76fde891ccc29283b3f5c8dcdce089c5b3d937d1/LICENSE",
      },
      { title: "Paperclip docs", url: "https://docs.paperclip.ing/" },
      { title: "Paperclip connectors", url: "https://docs.paperclip.ing/connectors/" },
      {
        title: "Paperclip deployment modes",
        url: "https://github.com/paperclipai/paperclip/blob/76fde891ccc29283b3f5c8dcdce089c5b3d937d1/docs/deploy/deployment-modes.md",
      },
      { title: "Paperclip multi-user login", url: "https://docs.paperclip.ing/how-to/enable-multi-user-login/" },
      { title: "Paperclip Claude Code adapter", url: "https://docs.paperclip.ing/adapters/claude-local" },
      { title: "Paperclip waitlist", url: "https://paperclip.ing/waitlist/" },
    ],
  },
];
