import { type Product, text } from "./shared.ts";

const openclawReadme = "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/README.md";

export const openclaw: Product = {
  slug: "openclaw",
  name: "OpenClaw",
  logo: "openclaw.svg",
  source: "https://github.com/openclaw/openclaw",
  detailSource: "https://docs.openclaw.ai/concepts/multi-agent",
  sources: [
    { title: "OpenClaw on GitHub", url: "https://github.com/openclaw/openclaw" },
    { title: "OpenClaw README", url: openclawReadme },
    { title: "OpenClaw multi-agent routing", url: "https://docs.openclaw.ai/concepts/multi-agent" },
    { title: "OpenClaw cron jobs", url: "https://docs.openclaw.ai/automation/cron-jobs" },
    {
      title: "OpenClaw license",
      url: "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/LICENSE",
    },
  ],
  license: "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/LICENSE",
  rowSources: [
    [openclawReadme, "https://docs.openclaw.ai/concepts/multi-agent"],
    [openclawReadme],
    [openclawReadme],
    ["https://docs.openclaw.ai/concepts/multi-agent"],
    [openclawReadme],
    ["https://docs.openclaw.ai/automation/cron-jobs", openclawReadme],
    [openclawReadme],
    ["https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/LICENSE", openclawReadme],
  ],
  short: text("personal assistant", "asistente personal"),
  tagline: text("choosing an agent setup", "cómo elegir una configuración de agentes"),
  intro: text(
    "APX and OpenClaw are open-source options for running AI agents on your own hardware. Both document chat channels, multi-agent setups and scheduled work. They organize that work differently; the better fit depends on the workflow you want to run.",
    "APX y OpenClaw son opciones de código abierto para ejecutar agentes de IA en tu propio equipo. Ambos documentan canales de chat, configuraciones multiagente y trabajo programado. Organizan ese trabajo de manera diferente; la mejor opción depende del flujo que quieras usar.",
  ),
  choice: text(
    "You want a personal assistant across your chat apps and devices, with a gateway, companion apps and an extensive plugin ecosystem.",
    "Querés un asistente personal entre tus chats y dispositivos, con una conexión central, apps complementarias y un ecosistema de plugins.",
  ),
  rows: [
    text(
      "A personal assistant across devices and chat apps; team deployments also documented.",
      "Un asistente personal entre dispositivos y chats; también documenta despliegues para equipos.",
    ),
    text(
      "Control UI, terminal UI and native desktop and mobile apps.",
      "Panel de control, terminal y apps nativas de escritorio y móvil.",
    ),
    text(
      "Your own hardware; hosted and local model providers are supported.",
      "Tus propios equipos; admite proveedores de modelos alojados y locales.",
    ),
    text(
      "Multi-agent routing and separate workspaces; team deployment options.",
      "Enrutamiento entre agentes y espacios de trabajo separados; opciones de despliegue para equipos.",
    ),
    text(
      "Workspace context, memory and reusable skills.",
      "Contexto del espacio de trabajo, memoria y habilidades reutilizables.",
    ),
    text(
      "Scheduled jobs and a broad channel catalog, including WhatsApp and Telegram.",
      "Trabajos programados y un catálogo amplio de canales, como WhatsApp y Telegram.",
    ),
    text(
      "Swappable model and agent plugins, tools and skills.",
      "Plugins intercambiables de modelos y agentes, herramientas y habilidades.",
    ),
    text(
      "MIT. Model and service usage can have separate costs.",
      "MIT. El uso de modelos y servicios puede tener costos aparte.",
    ),
  ],
  detail: text(
    "APX organizes a project around an ordinary folder following APC: root AGENTS.md, an .apc/ directory and individual project agent Markdown files. Its local database keeps runtime history separately. OpenClaw documents per-agent workspaces, state directories and session stores, with channel bindings that route messages to agents. Its workspaces also use readable files such as AGENTS.md: readable context and multiple agents are not exclusive to APX. This is a comparison of the linked documentation, not a head-to-head performance, security or reliability test. Self-hosting either app does not make connected cloud models offline.",
    "APX organiza un proyecto alrededor de una carpeta común que sigue APC: AGENTS.md en la raíz, un directorio .apc/ y archivos Markdown individuales para los agentes. Su base de datos local guarda el historial de ejecución por separado. OpenClaw documenta espacios de trabajo, directorios de estado y almacenamiento de sesiones por agente, con vinculaciones de canales que dirigen los mensajes. Sus espacios también usan archivos legibles como AGENTS.md: el contexto legible y los equipos de agentes no son exclusivos de APX. Esta comparación describe la documentación enlazada, no una prueba de rendimiento, seguridad ni confiabilidad entre ambos. Alojar cualquiera de las apps por tu cuenta no hace que los modelos conectados en la nube funcionen sin internet.",
  ),
  tryIt: text(
    "Consider APX if you want a project folder with an agent roster, tasks and APC context alongside the work. Consider OpenClaw if its Gateway, channel bindings and per-agent workspace model fit how you route conversations. Features and defaults can change: check the current guides, connect one channel and try a real task with a handoff before deciding.",
    "Considerá APX si querés una carpeta de proyecto con un equipo de agentes, tareas y contexto APC junto al trabajo. Considerá OpenClaw si su Gateway, sus vinculaciones de canales y su modelo de espacios por agente encajan con la forma en que dirigís las conversaciones. Las funciones y opciones predeterminadas pueden cambiar: revisá las guías actuales, conectá un canal y probá un trabajo real con un pase entre agentes antes de decidir.",
  ),
};
