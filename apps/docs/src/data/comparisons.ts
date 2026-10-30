export type Lang = "en" | "es";
type Copy = { en: string; es: string };
const text = (en: string, es: string): Copy => ({ en, es });
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
export const apxRowSources = [
  [apxDoc("concepts/agents"), apxDoc("office/tasks")],
  [apxDoc("devices/desktop"), apxDoc("devices/phone"), apxDoc("reference/cli")],
  [apxDoc("devices/server"), apxDoc("reference/privacy")],
  [apxDoc("concepts/agents"), apxDoc("office/tasks")],
  [apxDoc("concepts/memory"), apxDoc("extend/skills")],
  [apxDoc("office/routines"), apxDoc("channels/overview")],
  [apxDoc("concepts/models"), apxDoc("extend/mcp"), apxDoc("extend/skills")],
  [`${apxSource}/blob/${sourceSnapshots["agentprojectcontext/apx"]}/LICENSE`, apxDoc("concepts/models")],
];
const hermesReadme =
  "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/README.md";
const openclawReadme = "https://github.com/openclaw/openclaw/blob/b277db00687aabbf245c0d9287139a30bb2a22df/README.md";
const openbotComparison = "https://openbot.run/compare/hermes-agent";
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
export const comparisons = [
  {
    slug: "hermes-agent",
    name: "Hermes Agent",
    logo: "hermes.png",
    source: "https://github.com/NousResearch/hermes-agent",
    detailSource: hermesReadme,
    license: "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
    rowSources: [
      [hermesReadme],
      [hermesReadme],
      [hermesReadme],
      [hermesReadme],
      [hermesReadme],
      [hermesReadme],
      [hermesReadme],
      [
        "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
        hermesReadme,
      ],
    ],
    tagline: text(
      "A project crew or a self-improving assistant?",
      "¿Un equipo por proyecto o un asistente que aprende?",
    ),
    intro: text(
      "Both support memory, skills, delegation and scheduled work. The useful distinction is how you want to organize your day: a visible project crew in APX, or Hermes’ assistant and skill-learning workflow.",
      "Ambos ofrecen memoria, habilidades, delegación y trabajo programado. La diferencia útil está en cómo querés organizar tu día: un equipo visible por proyecto en APX, o el flujo de asistente y aprendizaje de habilidades de Hermes.",
    ),
    choice: text(
      "You want an assistant built around creating and improving skills from experience, with a terminal, desktop app and messaging gateway.",
      "Querés un asistente centrado en crear y mejorar habilidades a partir de la experiencia, con terminal, app de escritorio y conexión a mensajería.",
    ),
    rows: [
      text(
        "A self-improving assistant with a built-in skill-learning loop.",
        "Un asistente que aprende con un ciclo integrado de mejora de habilidades.",
      ),
      text(
        "Terminal UI, desktop app and messaging gateway.",
        "Interfaz de terminal, app de escritorio y conexión a mensajería.",
      ),
      text(
        "The agent runs on your computer or a server. Commands can run locally, in Docker, over SSH or in sandboxes such as Modal and Daytona.",
        "El agente corre en tu computadora o un servidor. Los comandos pueden ejecutarse localmente, en Docker, por SSH o en entornos como Modal y Daytona.",
      ),
      text(
        "Can spawn isolated subagents for parallel work.",
        "Puede crear subagentes aislados para trabajar en paralelo.",
      ),
      text(
        "Curated memory, past-conversation search and skills improved during use.",
        "Memoria curada, búsqueda en conversaciones anteriores y habilidades que mejoran con el uso.",
      ),
      text(
        "Built-in cron with platform delivery; Telegram, Discord, Slack and more.",
        "Cron integrado con entrega a plataformas; Telegram, Discord, Slack y más.",
      ),
      text(
        "Multiple model providers, MCP, skills and plugins.",
        "Varios proveedores de modelos, MCP, habilidades y plugins.",
      ),
      text(
        "MIT. Providers and hosted execution can cost extra.",
        "MIT. Los proveedores y la ejecución alojada pueden tener costos aparte.",
      ),
    ],
    detail: text(
      "Hermes explicitly documents skill creation and refinement as part of its learning loop. APX puts projects, named agents and task follow-through at the center. Hermes also delegates work: choosing APX is not a choice between having a team and having no delegation.",
      "Hermes documenta explícitamente la creación y mejora de habilidades como parte de su aprendizaje. APX pone en el centro los proyectos, los agentes con identidad y el seguimiento de tareas. Hermes también delega: elegir APX no es elegir entre tener equipo o no tener delegación.",
    ),
    tryIt: text(
      "Give each product a recurring research task and a follow-up a week later. Check what it remembers, how you correct it and how easily you find the result.",
      "Dale a cada producto una investigación recurrente y retomá el tema una semana después. Revisá qué recuerda, cómo lo corregís y qué tan fácil encontrás el resultado.",
    ),
  },
  {
    slug: "openclaw",
    name: "OpenClaw",
    logo: "openclaw.svg",
    source: "https://github.com/openclaw/openclaw",
    detailSource: "https://docs.openclaw.ai/concepts/multi-agent",
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
  },
  {
    slug: "openbot",
    name: "OpenBot",
    logo: "openbot.png",
    source: "https://openbot.run/",
    detailSource: "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
    license: "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
    rowSources: [
      ["https://openbot.run/", openbotComparison],
      [openbotComparison],
      [openbotComparison],
      [openbotComparison],
      [openbotComparison],
      [openbotComparison],
      [openbotComparison],
      [
        "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
        openbotComparison,
      ],
    ],
    tagline: text(
      "Two local crews. Different ways to own the work.",
      "Dos equipos locales. Distintas formas de hacer tuyo el trabajo.",
    ),
    intro: text(
      "Both offer persistent teammates, a desktop app and multiple AI providers. Compare the workflow you prefer and the license you need, rather than treating local agents or provider choice as exclusive to either product.",
      "Ambos ofrecen compañeros persistentes, una app de escritorio y varios proveedores de IA. Compará el flujo que preferís y la licencia que necesitás, sin tratar los agentes locales o la elección de proveedor como algo exclusivo de uno.",
    ),
    choice: text(
      "You prefer OpenBot’s teammate workspaces, provider switching and queued messages, and its license fits your intended use.",
      "Preferís los espacios de trabajo, el cambio de proveedor y los mensajes en cola de OpenBot, y su licencia sirve para el uso que querés darle.",
    ),
    rows: [
      text(
        "Persistent AI teammates with their own instructions and workspaces.",
        "Compañeros de IA persistentes con instrucciones y espacios de trabajo propios.",
      ),
      text(
        "Desktop app for macOS, Windows and Linux; iOS and Android companions.",
        "App de escritorio para macOS, Windows y Linux; apps complementarias iOS y Android.",
      ),
      text(
        "Workspaces and conversations stored on your computer; prompts go to chosen providers.",
        "Espacios de trabajo y conversaciones en tu computadora; los mensajes van a los proveedores elegidos.",
      ),
      text(
        "Agents message each other, hand off tasks and share files.",
        "Los agentes se envían mensajes, se pasan tareas y comparten archivos.",
      ),
      text(
        "Persistent workspaces and conversations, including when switching providers.",
        "Espacios de trabajo y conversaciones persistentes, incluso al cambiar de proveedor.",
      ),
      text(
        "Scheduled routines and connected chat channels, including Slack, Discord and Telegram.",
        "Rutinas programadas y canales de chat conectados, como Slack, Discord y Telegram.",
      ),
      text(
        "Codex, Claude Code, ACP agents and compatible endpoints, including local models.",
        "Codex, Claude Code, agentes ACP y servicios compatibles, incluidos modelos locales.",
      ),
      text(
        "PolyForm Noncommercial 1.0.0 defines the permitted uses. Uses outside those permissions may require separate permission; read the terms. Provider costs are separate.",
        "PolyForm Noncommercial 1.0.0 define los usos permitidos. Un uso fuera de esos permisos puede requerir otra autorización; leé los términos. Los proveedores se pagan aparte.",
      ),
    ],
    detail: text(
      "APX uses MIT; OpenBot uses PolyForm Noncommercial 1.0.0 and offers a separate commercial license. Its terms define permitted purposes, including certain organizational uses; do not treat every business context as automatically prohibited. Both offer local workspaces, scheduled routines and AI-provider choice. Check the license against your intended use.",
      "APX usa MIT; OpenBot usa PolyForm Noncommercial 1.0.0 y ofrece una licencia comercial aparte. Sus términos definen los fines permitidos, incluidos ciertos usos por organizaciones; no todo contexto de negocio queda automáticamente prohibido. Ambos ofrecen espacios locales, rutinas programadas y elección de proveedor de IA. Revisá la licencia según el uso que querés darle.",
    ),
    tryIt: text(
      "Run a small project with two agents, change one agent’s provider and review the handoff. Check the current license terms against your intended use before rollout.",
      "Probá un proyecto pequeño con dos agentes, cambiá el proveedor de uno y revisá el pase de trabajo. Revisá los términos de licencia vigentes según el uso que querés darle antes de implementarlo.",
    ),
  },
];
export type Comparison = (typeof comparisons)[number];
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
