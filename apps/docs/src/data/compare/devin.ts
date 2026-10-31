import { type Product, text } from "./shared.ts";

export const devin: Product = {
  slug: "devin",
  name: "Devin",
  logo: "devin.png",
  source: "https://devin.ai/",
  detailSource: "https://devin.ai/blog/windsurf-is-now-devin-desktop",
  license: "https://cognition.com/legal/platform-terms-of-service",
  sources: [
    { title: "Devin home", url: "https://devin.ai/" },
    { title: "Devin pricing", url: "https://devin.ai/pricing" },
    { title: "Devin Cloud", url: "https://devin.ai/cloud" },
    { title: "Windsurf is now Devin Desktop", url: "https://devin.ai/blog/windsurf-is-now-devin-desktop" },
    { title: "Devin Cloud in your terminal", url: "https://devin.ai/blog/devin-cloud-in-your-terminal" },
    { title: "Introducing Devin (docs)", url: "https://docs.devin.ai/get-started/devin-intro" },
    { title: "Devin CLI", url: "https://docs.devin.ai/work-with-devin/devin-cli" },
    { title: "Devin CLI models", url: "https://docs.devin.ai/cli/models" },
    { title: "Devin Desktop getting started", url: "https://docs.devin.ai/desktop/getting-started" },
    { title: "Devin Desktop ACP agents", url: "https://docs.devin.ai/desktop/acp" },
    { title: "Devin automations", url: "https://docs.devin.ai/product-guides/automations" },
    { title: "Devin Outposts", url: "https://docs.devin.ai/cloud/outposts/overview" },
    { title: "Devin integrations", url: "https://docs.devin.ai/integrations/overview" },
    { title: "Devin Knowledge and Skills", url: "https://docs.devin.ai/product-guides/knowledge" },
    { title: "Devin with a ChatGPT plan", url: "https://docs.devin.ai/admin/billing/chatgpt" },
    { title: "Cognition Platform Terms of Service", url: "https://cognition.com/legal/platform-terms-of-service" },
  ],
  rowSources: [
    ["https://devin.ai/", "https://docs.devin.ai/get-started/devin-intro"],
    [
      "https://docs.devin.ai/get-started/devin-intro",
      "https://docs.devin.ai/desktop/getting-started",
      "https://docs.devin.ai/work-with-devin/devin-cli",
    ],
    [
      "https://devin.ai/cloud",
      "https://docs.devin.ai/cloud/outposts/overview",
      "https://docs.devin.ai/work-with-devin/devin-cli",
    ],
    ["https://devin.ai/cloud", "https://devin.ai/blog/windsurf-is-now-devin-desktop", "https://devin.ai/pricing"],
    [
      "https://docs.devin.ai/product-guides/knowledge",
      "https://docs.devin.ai/desktop/getting-started",
      "https://devin.ai/blog/windsurf-is-now-devin-desktop",
    ],
    ["https://docs.devin.ai/product-guides/automations", "https://docs.devin.ai/integrations/overview"],
    [
      "https://docs.devin.ai/cli/models",
      "https://docs.devin.ai/desktop/acp",
      "https://docs.devin.ai/integrations/overview",
      "https://docs.devin.ai/admin/billing/chatgpt",
    ],
    ["https://cognition.com/legal/platform-terms-of-service", "https://devin.ai/pricing"],
  ],
  short: text("AI software engineer", "ingeniero de software con IA"),
  tagline: text(
    "A project crew or an AI software engineer?",
    "¿Un equipo por proyecto o un ingeniero de software con IA?",
  ),
  intro: text(
    "Both can run several agents, follow work over time and connect to chat tools. Devin is built around software engineering, from local coding to cloud sessions that end in pull requests; APX organizes any kind of project work into a crew and a task board.",
    "Ambos pueden correr varios agentes, seguir trabajo en el tiempo y conectarse a herramientas de chat. Devin está pensado para ingeniería de software, desde programar en local hasta sesiones en la nube que terminan en pull requests; APX organiza cualquier tipo de trabajo de proyecto en un equipo y un tablero de tareas.",
  ),
  choice: text(
    "You want a coding agent that works in an IDE, a terminal and cloud VMs, and turns tickets, alerts and CI failures into pull requests.",
    "Querés un agente de programación que trabaje en un IDE, una terminal y máquinas en la nube, y convierta tickets, alertas y fallas de CI en pull requests.",
  ),
  rows: [
    text(
      "An autonomous AI software engineer that plans, codes, tests and opens pull requests.",
      "Un ingeniero de software con IA autónomo que planifica, programa, prueba y abre pull requests.",
    ),
    text(
      "Web app, Devin Desktop IDE (macOS, Windows, Linux), CLI, Slack, Microsoft Teams and an API.",
      "App web, el IDE Devin Desktop (macOS, Windows, Linux), CLI, Slack, Microsoft Teams y una API.",
    ),
    text(
      "Cloud sessions run on Devin's VMs; Desktop and CLI work locally. Outposts runs commands on your machines, with the agent loop in Devin's cloud.",
      "Las sesiones en la nube corren en máquinas de Devin; Desktop y la CLI trabajan en local. Outposts ejecuta comandos en tus máquinas, con el agente en la nube de Devin.",
    ),
    text(
      "Parallel cloud agents, subagents in the local agent and one board for local and cloud sessions; Teams plan for sharing.",
      "Agentes en paralelo en la nube, subagentes en el agente local y un tablero para sesiones locales y en la nube; plan Teams para compartir.",
    ),
    text(
      "Skills, AGENTS.md and rules; Spaces share context between agents. Older Knowledge notes are moving to Skills.",
      "Habilidades, AGENTS.md y reglas; los Spaces comparten contexto entre agentes. Las notas de Knowledge anteriores pasan a habilidades.",
    ),
    text(
      "Automations on schedules or on Slack, GitHub, PagerDuty and webhook events; tag Devin in Slack or Teams.",
      "Automatizaciones con horario o ante eventos de Slack, GitHub, PagerDuty y webhooks; mencioná a Devin en Slack o Teams.",
    ),
    text(
      "Models from Anthropic, OpenAI, Google, Cognition and open-source families; MCP, ACP agents in Desktop and an optional ChatGPT plan link.",
      "Modelos de Anthropic, OpenAI, Google, Cognition y familias de código abierto; MCP, agentes ACP en Desktop y vínculo opcional con un plan de ChatGPT.",
    ),
    text(
      "Proprietary (Cognition terms). Free; Pro $20/month; Max $200/month; Teams $80/month plus $40 per seat; Enterprise on request.",
      "Propietario (términos de Cognition). Free; Pro USD 20/mes; Max USD 200/mes; Teams USD 80/mes más USD 40 por puesto; Enterprise a consultar.",
    ),
  ],
  detail: text(
    "Devin is a coding product end to end: its desktop app is the former Windsurf IDE, and cloud sessions get their own VM with a browser and terminal so they keep working when your laptop is closed. It also has multi-agent work, skills, automations and chat triggers, so the difference is not whether agents can collaborate. APX is a general project office on your computer or server, while Devin's agents, cloud sessions and billing run through Cognition's platform.",
    "Devin es un producto de programación de punta a punta: su app de escritorio es el antiguo IDE Windsurf, y las sesiones en la nube tienen su propia máquina con navegador y terminal, así que siguen trabajando con la laptop cerrada. También ofrece trabajo entre agentes, habilidades, automatizaciones y disparadores desde chats, así que la diferencia no es si los agentes pueden colaborar. APX es una oficina de proyectos general en tu computadora o servidor, mientras que los agentes, las sesiones en la nube y la facturación de Devin pasan por la plataforma de Cognition.",
  ),
  tryIt: text(
    "Give each one the same bug ticket in a real repository and a scheduled follow-up check. Compare how you review the change, where it ran and what it cost.",
    "Dale a cada uno el mismo ticket de bug en un repositorio real y un chequeo programado de seguimiento. Compará cómo revisás el cambio, dónde se ejecutó y cuánto costó.",
  ),
};
