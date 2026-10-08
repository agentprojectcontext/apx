// The home page's words, in English and Spanish (rioplatense). Doc pages are translated as files under es/.
export type Lang = "en" | "es";

const en = {
  title: "APX docs: meet your crew",
  description:
    "Documentation for APX v2: a crew of AI agents that lives on your machine. Install it, meet Home, add a project and put your agents to work.",
  nav: { start: "Start", ideas: "Core ideas", office: "Office", channels: "Channels", cli: "CLI" },
  pill: { strong: "APX v2 docs", rest: "· one way to do each thing" },
  meet: "Learn",
  your: "your",
  words: ["crew.", "secretary.", "office.", "routines.", "channels."],
  sub: {
    strong: "The APX v2 docs.",
    rest: "Install it, meet Home, add a project and put a crew of agents to work.",
  },
  copy: "Copy",
  copied: "Copied",
  getStarted: "Get started",
  browse: "Browse the docs",
  status: [
    ["Home", "is sorting your inbox"],
    ["Lucía", "is planning the Q4 launch"],
    ["Tomás", "is opening a Claude Code session"],
    ["Vera", "is drafting Friday's newsletter"],
  ],
  bubbles: [
    "@tomás can you check the checkout?",
    "On it. Found it, shipping a fix.",
    "Newsletter scheduled for 9:00 ✓",
  ],
  shotAlt: "The APX panel in the light theme: the Home chat with the crew",
  real: { light: "Light", dark: "Dark", body: "Every screenshot is the real app, in the theme you are reading in." },
  steps: {
    eyebrow: "Three steps",
    title: "From zero to your first agent.",
    items: [
      {
        n: "01",
        title: "Install APX",
        body: "The desktop app on macOS, Windows or Linux, or the core alone on a server.",
        href: "/start/install/",
        cta: "Install",
      },
      {
        n: "02",
        title: "Meet Home",
        body: "Your secretary. Tell it your name, pick a model and say hi.",
        href: "/start/first-steps/",
        cta: "First steps",
      },
      {
        n: "03",
        title: "Give it a project",
        body: "Point APX at a folder. Its agents come from AGENTS.md and .apc/.",
        href: "/concepts/projects/",
        cta: "Projects",
      },
    ],
  },
  map: {
    eyebrow: "Find your way",
    title: "Everything your crew can do.",
    lead: "Seven sections. Start at the top or jump straight in.",
  },
  sections: [
    {
      blob: "menta",
      title: "Start here",
      body: "What APX is, how to install it and your first ten minutes.",
      links: [
        ["Introduction", "/start/introduction/"],
        ["Install", "/start/install/"],
        ["First steps", "/start/first-steps/"],
        ["Coming from v1", "/start/from-v1/"],
      ],
    },
    {
      blob: "orbita",
      title: "Core ideas",
      body: "Agents, projects, conversations, models, autonomy and memory.",
      links: [
        ["Agents", "/concepts/agents/"],
        ["Conversations", "/concepts/conversations/"],
        ["Models", "/concepts/models/"],
        ["Autonomy", "/concepts/autonomy/"],
      ],
    },
    {
      blob: "cobalto",
      title: "Your office",
      body: "Chat, tasks, routines, the secretary, the board and the browser.",
      links: [
        ["Chat", "/office/chat/"],
        ["Tasks", "/office/tasks/"],
        ["Routines", "/office/routines/"],
        ["Browser", "/office/browser/"],
      ],
    },
    {
      blob: "brasa",
      title: "Channels",
      body: "Talk to your crew from Telegram, WhatsApp, Discord, Slack and iMessage.",
      links: [
        ["Overview", "/channels/overview/"],
        ["Telegram", "/channels/telegram/"],
        ["WhatsApp", "/channels/whatsapp/"],
      ],
    },
    {
      blob: "amatista",
      title: "Extend",
      body: "Skills, MCP servers, extensions, integrations and outside clients.",
      links: [
        ["Skills", "/extend/skills/"],
        ["MCP servers", "/extend/mcp/"],
        ["Extensions", "/extend/extensions/"],
      ],
    },
    {
      blob: "aqua",
      title: "Everywhere",
      body: "The desktop app, your phone, and a core on a server you reach from anywhere.",
      links: [
        ["Desktop app", "/devices/desktop/"],
        ["Phone", "/devices/phone/"],
        ["Server and remote", "/devices/server/"],
      ],
    },
    {
      blob: "noche",
      title: "Reference",
      body: "Every apx command, every setting, and what to do when something breaks.",
      links: [
        ["CLI", "/reference/cli/"],
        ["Configuration", "/reference/configuration/"],
        ["Troubleshooting", "/reference/troubleshooting/"],
      ],
    },
  ],
  one: {
    eyebrow: "Why v2",
    title: "One way to do each thing.",
    lead: "v2 is a ground-up rewrite with a single rule. Fewer paths means fewer surprises, and a smaller bill.",
    stats: [
      ["1", "way to run a turn", "was ~23 in v1"],
      ["1", "way to talk to an agent", "threads.send, everywhere"],
      ["~230", "typed methods in one registry", "was ~378 ad-hoc endpoints"],
      ["8.1k", "tokens per model call", "the least of the apps we measured"],
    ],
    bars: {
      title: "Tokens every model call carries, fresh install",
      note: "Measured with each app's own prompt builder.",
    },
  },
  anywhere: {
    eyebrow: "Talk to them from anywhere",
    title: "Your crew lives in your chats.",
    lead: "The same agents, memory and tools in the app, the terminal, your phone and the messaging apps you already use.",
  },
  cli: {
    eyebrow: "Prefer the terminal?",
    title: "Everything has a command.",
    lead: "Ask Home without leaving your shell.",
  },
  final: {
    parade: "These are the blobos: 35 faces to give your agents.",
    title: "Your crew is waiting.",
    tag: "One machine. One context. Your whole crew.",
    body: "Free and open source. Your data stays on your machine.",
  },
  footer: "Reference runtime of the APC standard.",
  langLabel: "Language",
  themeLabel: "Toggle theme",
  discord: "Join the Discord",
};

export type HomeText = typeof en;

const es: HomeText = {
  title: "Docs de APX: conocé a tu crew",
  description:
    "Documentación de APX v2: un crew de agentes de IA que vive en tu máquina. Instalalo, conocé a Home, sumá un proyecto y poné a trabajar a tus agentes.",
  nav: { start: "Empezar", ideas: "Ideas clave", office: "Oficina", channels: "Canales", cli: "CLI" },
  pill: { strong: "Docs de APX v2", rest: "· una sola forma de hacer cada cosa" },
  meet: "Conocé",
  your: "a tu",
  words: ["crew.", "secretaria.", "oficina.", "turno noche.", "equipo."],
  sub: {
    strong: "La documentación de APX v2.",
    rest: "Instalalo, conocé a Home, sumá un proyecto y poné a trabajar a tu crew de agentes.",
  },
  copy: "Copiar",
  copied: "Copiado",
  getStarted: "Empezar",
  browse: "Ver la doc",
  status: [
    ["Home", "está ordenando tu bandeja"],
    ["Lucía", "está planeando el lanzamiento"],
    ["Tomás", "está abriendo una sesión de Claude Code"],
    ["Vera", "está escribiendo el newsletter"],
  ],
  bubbles: [
    "@tomás, ¿podés revisar el checkout?",
    "Voy. Lo encontré, subo el arreglo.",
    "Newsletter programado para las 9:00 ✓",
  ],
  shotAlt: "El panel de APX en tema claro: el chat de Home con el crew",
  real: { light: "Claro", dark: "Oscuro", body: "Cada captura es la app de verdad, en el tema en que estás leyendo." },
  steps: {
    eyebrow: "Tres pasos",
    title: "De cero a tu primer agente.",
    items: [
      {
        n: "01",
        title: "Instalá APX",
        body: "La app de escritorio en macOS, Windows o Linux, o solo el core en un servidor.",
        href: "/es/start/install/",
        cta: "Instalar",
      },
      {
        n: "02",
        title: "Conocé a Home",
        body: "Tu secretaria. Decile tu nombre, elegí un modelo y saludala.",
        href: "/es/start/first-steps/",
        cta: "Primeros pasos",
      },
      {
        n: "03",
        title: "Dale un proyecto",
        body: "Apuntá APX a una carpeta. Sus agentes salen de AGENTS.md y .apc/.",
        href: "/es/concepts/projects/",
        cta: "Proyectos",
      },
    ],
  },
  map: {
    eyebrow: "Encontrá tu camino",
    title: "Todo lo que tu crew puede hacer.",
    lead: "Siete secciones. Empezá arriba o saltá directo.",
  },
  sections: [
    {
      blob: "menta",
      title: "Empezar",
      body: "Qué es APX, cómo instalarlo y tus primeros diez minutos.",
      links: [
        ["Introducción", "/es/start/introduction/"],
        ["Instalación", "/es/start/install/"],
        ["Primeros pasos", "/es/start/first-steps/"],
        ["Si venís de v1", "/es/start/from-v1/"],
      ],
    },
    {
      blob: "orbita",
      title: "Ideas clave",
      body: "Agentes, proyectos, conversaciones, modelos, autonomía y memoria.",
      links: [
        ["Agentes", "/es/concepts/agents/"],
        ["Conversaciones", "/es/concepts/conversations/"],
        ["Modelos", "/es/concepts/models/"],
        ["Autonomía", "/es/concepts/autonomy/"],
      ],
    },
    {
      blob: "cobalto",
      title: "Tu oficina",
      body: "Chat, tareas, rutinas, la secretaria, el tablero y el navegador.",
      links: [
        ["Chat", "/es/office/chat/"],
        ["Tareas", "/es/office/tasks/"],
        ["Rutinas", "/es/office/routines/"],
        ["Navegador", "/es/office/browser/"],
      ],
    },
    {
      blob: "brasa",
      title: "Canales",
      body: "Hablale a tu crew por Telegram, WhatsApp, Discord, Slack e iMessage.",
      links: [
        ["Resumen", "/es/channels/overview/"],
        ["Telegram", "/es/channels/telegram/"],
        ["WhatsApp", "/es/channels/whatsapp/"],
      ],
    },
    {
      blob: "amatista",
      title: "Extender",
      body: "Skills, servidores MCP, extensiones, integraciones y clientes de afuera.",
      links: [
        ["Skills", "/es/extend/skills/"],
        ["Servidores MCP", "/es/extend/mcp/"],
        ["Extensiones", "/es/extend/extensions/"],
      ],
    },
    {
      blob: "aqua",
      title: "En todos lados",
      body: "La app de escritorio, tu celular y un core en un servidor al que llegás desde donde estés.",
      links: [
        ["App de escritorio", "/es/devices/desktop/"],
        ["Celular", "/es/devices/phone/"],
        ["Servidor y remoto", "/es/devices/server/"],
      ],
    },
    {
      blob: "noche",
      title: "Referencia",
      body: "Cada comando de apx, cada ajuste y qué hacer cuando algo falla.",
      links: [
        ["CLI", "/es/reference/cli/"],
        ["Configuración", "/es/reference/configuration/"],
        ["Problemas comunes", "/es/reference/troubleshooting/"],
      ],
    },
  ],
  one: {
    eyebrow: "Por qué v2",
    title: "Una sola forma de hacer cada cosa.",
    lead: "v2 es una reescritura desde cero con una sola regla. Menos caminos es menos sorpresas, y una cuenta más chica.",
    stats: [
      ["1", "forma de correr un turno", "eran ~23 en v1"],
      ["1", "forma de hablarle a un agente", "threads.send, en todos lados"],
      ["~230", "métodos tipados en un registro", "eran ~378 endpoints sueltos"],
      ["8,1k", "tokens por llamada al modelo", "lo menos de las apps que medimos"],
    ],
    bars: {
      title: "Tokens que lleva cada llamada al modelo, instalación nueva",
      note: "Medido con el armador de prompt de cada app.",
    },
  },
  anywhere: {
    eyebrow: "Hablales desde donde estés",
    title: "Tu crew vive en tus chats.",
    lead: "Los mismos agentes, la misma memoria y las mismas herramientas en la app, la terminal, el celular y las apps de mensajes que ya usás.",
  },
  cli: {
    eyebrow: "¿Preferís la terminal?",
    title: "Todo tiene su comando.",
    lead: "Preguntale a Home sin salir de tu shell.",
  },
  final: {
    parade: "Estos son los blobos: 35 caras para tus agentes.",
    title: "Tu crew te está esperando.",
    tag: "Una máquina. Un contexto. Todo tu crew.",
    body: "Gratis y open source. Tus datos quedan en tu máquina.",
  },
  footer: "Runtime de referencia del estándar APC.",
  langLabel: "Idioma",
  themeLabel: "Cambiar tema",
  discord: "Sumate al Discord",
};

export const HOME: Record<Lang, HomeText> = { en, es };
