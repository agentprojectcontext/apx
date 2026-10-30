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
  tagline: text("Your project crew or your personal assistant?", "¿Tu equipo de proyectos o tu asistente personal?"),
  intro: text(
    "Both run on hardware you control and connect AI to everyday work. APX organizes that work into projects and a crew. OpenClaw presents a personal assistant across your devices and chats, with multi-agent routing available too.",
    "Ambos corren en equipos que controlás y conectan la IA con tu trabajo cotidiano. APX organiza ese trabajo en proyectos y un equipo. OpenClaw propone un asistente personal entre tus dispositivos y chats, y también ofrece enrutamiento entre agentes.",
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
    "OpenClaw is not a chat-only tool: its official project documents native apps, device nodes, skills, multiple agents and team deployments. APX’s project-and-task workflow is the reason to evaluate it, not a claim that OpenClaw lacks those building blocks.",
    "OpenClaw no es solo un chat: su proyecto oficial documenta apps nativas, dispositivos conectados, habilidades, varios agentes y despliegues para equipos. El flujo de proyectos y tareas de APX es una razón para evaluarlo, no una afirmación de que OpenClaw carece de esas capacidades.",
  ),
  tryIt: text(
    "Connect one channel and ask for a task that needs a handoff. Compare setup, approvals and how you follow the work from your phone and computer.",
    "Conectá un canal y pedí una tarea que necesite un pase entre agentes. Compará la configuración, las aprobaciones y cómo seguís el trabajo desde el teléfono y la computadora.",
  ),
};
