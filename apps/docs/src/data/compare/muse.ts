import { type Product, text } from "./shared.ts";

export const muse: Product = {
  slug: "muse",
  name: "Muse",
  logo: "muse.svg",
  source: "https://muse.ai/",
  detailSource: "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
  license: "https://muse.ai/terms",
  sources: [
    {
      title: "Introducing Muse (Meta newsroom)",
      url: "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/",
    },
    {
      title: "Muse security and safety (Meta research)",
      url: "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
    },
    {
      title: "Meta Connect 2026 announcements",
      url: "https://www.meta.com/blog/meta-connect-2026-everything-we-announced/",
    },
    { title: "Muse for small business", url: "https://muse.ai/business" },
    { title: "Muse subscription plans (Meta help)", url: "https://www.meta.com/help/subscriptions/1021145227643680/" },
    { title: "Using Muse (Meta help)", url: "https://www.meta.com/help/artificial-intelligence/1331373868832401/" },
    { title: "Muse privacy policy", url: "https://muse.ai/privacy" },
    { title: "Muse supplemental terms", url: "https://muse.ai/terms" },
  ],
  rowSources: [
    ["https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/"],
    [
      "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/",
      "https://www.meta.com/blog/meta-connect-2026-everything-we-announced/",
    ],
    [
      "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
      "https://muse.ai/privacy",
    ],
    [
      "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
      "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/",
    ],
    [
      "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
      "https://www.meta.com/help/artificial-intelligence/1331373868832401/",
    ],
    [
      "https://www.meta.com/help/artificial-intelligence/1331373868832401/",
      "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
      "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/",
    ],
    [
      "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/",
      "https://muse.ai/business",
      "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
    ],
    ["https://muse.ai/terms", "https://www.meta.com/help/subscriptions/1021145227643680/"],
  ],
  short: text("Meta's personal agent", "agente personal de Meta"),
  tagline: text("A project crew or Meta's personal agent?", "¿Un equipo por proyecto o el agente personal de Meta?"),
  intro: text(
    "Muse is Meta's personal AI agent: it turns goals into plans and handles tasks like emails, bookings and shopping from a cloud machine Meta runs for each person. APX organizes a team of agents around your projects, on a computer or server you control.",
    "Muse es el agente personal de IA de Meta: convierte objetivos en planes y resuelve tareas como correos, reservas y compras desde una máquina en la nube que Meta mantiene para cada persona. APX organiza un equipo de agentes alrededor de tus proyectos, en una computadora o servidor que controlás.",
  ),
  choice: text(
    "You want a personal agent for errands and life tasks in the Muse app or WhatsApp, with built-in shopping and payment connectors.",
    "Querés un agente personal para trámites y tareas del día a día en la app de Muse o en WhatsApp, con conectores de compras y pagos ya integrados.",
  ),
  rows: [
    text(
      "A personal agent for goals, tasks and errands, such as sending emails or booking travel.",
      "Un agente personal para objetivos, tareas y trámites, como mandar correos o reservar viajes.",
    ),
    text(
      "iOS and Android apps, the web, WhatsApp and a Mac app with computer use.",
      "Apps para iOS y Android, la web, WhatsApp y una app para Mac que puede usar la computadora.",
    ),
    text(
      "A dedicated cloud virtual machine per person, run by Meta; it holds your data and credentials. Some data leaves it for inference.",
      "Una máquina virtual en la nube para cada persona, operada por Meta; guarda tus datos y credenciales. Algunos datos salen de ella para la inferencia.",
    ),
    text(
      "Can launch subagents for concurrent work; a separate agent, Sentinel, approves what goes out.",
      "Puede lanzar subagentes para trabajar en paralelo; un agente aparte, Sentinel, aprueba lo que sale.",
    ),
    text(
      "Memory you can inspect, edit and download; side chats and a library of created files.",
      "Memoria que podés revisar, editar y descargar; chats laterales y una biblioteca de archivos creados.",
    ),
    text(
      "Reminders and scheduled tasks; you message it in the Muse app or WhatsApp.",
      "Recordatorios y tareas programadas; le escribís desde la app de Muse o WhatsApp.",
    ),
    text(
      "Meta's Muse Spark model; built-in connectors such as Notion, Shopify and Slack, and custom connectors it writes.",
      "El modelo Muse Spark de Meta; conectores integrados como Notion, Shopify y Slack, y conectores propios que escribe.",
    ),
    text(
      "Proprietary (Meta). Free with a weekly limit; Power $20/month and Maximum $100/month.",
      "Propietario (Meta). Gratis con un límite semanal; Power a USD 20/mes y Maximum a USD 100/mes.",
    ),
  ],
  detail: text(
    "Muse gives each person an isolated cloud machine run by Meta, with a separate agent that approves connector actions and network access according to the rules you set. Meta documents subagents, scheduled tasks and a wide set of shopping and work connectors, aimed at one person's life and errands. APX keeps work on your computer or server and organizes it around projects, named agents and a shared task board.",
    "Muse le da a cada persona una máquina aislada en la nube operada por Meta, con un agente aparte que aprueba las acciones de los conectores y el acceso a la red según las reglas que definís. Meta documenta subagentes, tareas programadas y muchos conectores de compras y trabajo, pensados para la vida y los trámites de una persona. APX mantiene el trabajo en tu computadora o servidor y lo organiza por proyectos, agentes con nombre y un tablero de tareas compartido.",
  ),
  tryIt: text(
    "Give each one a goal that takes a week, like planning a trip with a reminder before each step. Check what it asks you to approve, what it remembers and where you review the results.",
    "Dale a cada uno un objetivo de una semana, como planear un viaje con un recordatorio antes de cada paso. Fijate qué te pide aprobar, qué recuerda y dónde revisás los resultados.",
  ),
};
