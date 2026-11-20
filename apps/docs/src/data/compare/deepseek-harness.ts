import { type Product, text } from "./shared.ts";

const at = "https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e";
const readme = `${at}/README.md`;
const license = `${at}/LICENSE`;
const safety = `${at}/SAFETY.md`;
const guide = `${at}/docs/user/guide/index.md`;
const providers = `${at}/docs/user/guide/providers.md`;
const schedule = `${at}/docs/user/guide/schedule.md`;
const memory = `${at}/docs/user/guide/mcp-memory.md`;
const plugins = `${at}/docs/user/guide/plugin-market.md`;
const subagents = `${at}/docs/subsystems/subagent.md`;
const deployments = `${at}/docs/user/guide/public-deployments.md`;

export const deepseekHarness: Product = {
  slug: "deepseek-harness",
  name: "DeepSeek Harness",
  logo: "deepseek-harness.svg",
  checked: "2026-11-20",
  source: "https://github.com/deepseek-ai/deepseek-harness",
  detailSource: readme,
  sources: [
    { title: "DeepSeek Harness on GitHub", url: "https://github.com/deepseek-ai/deepseek-harness" },
    { title: "DeepSeek Harness README", url: readme },
    { title: "DeepSeek Harness safety notice", url: safety },
    { title: "DeepSeek Harness Web UI guide", url: guide },
    { title: "DeepSeek Harness model configuration", url: providers },
    { title: "DeepSeek Harness schedule reminders", url: schedule },
    { title: "DeepSeek Harness memory MCP servers", url: memory },
    { title: "DeepSeek Harness plugin indexes", url: plugins },
    { title: "DeepSeek Harness subagents", url: subagents },
    { title: "DeepSeek Harness license", url: license },
  ],
  license,
  rowSources: [
    [readme],
    [readme, guide],
    [guide, deployments, safety],
    [subagents],
    [memory],
    [schedule],
    [providers, memory, plugins],
    [license, providers],
  ],
  short: text("pluggable agent harness", "arnés de agentes armable"),
  tagline: text("A ready office or a runtime you assemble?", "¿Una oficina lista o un motor que armás vos?"),
  intro: text(
    "DeepSeek Harness is DeepSeek's open agent runtime, where models, tools, skills, sessions, storage and even the interface are plugins. APX is an app with a crew already organized by project. Both run agents on your machine; the difference is how much you want to build.",
    "DeepSeek Harness es el motor de agentes abierto de DeepSeek, donde los modelos, las herramientas, las skills, las sesiones, el guardado y hasta la interfaz son plugins. APX es una app con una crew ya organizada por proyecto. Los dos corren agentes en tu máquina; la diferencia es cuánto querés armar vos.",
  ),
  choice: text(
    "You want an open, hackable agent runtime to rebuild piece by piece, around DeepSeek's models or any compatible API, and a developer preview is fine for you.",
    "Querés un motor de agentes abierto para rearmar pieza por pieza, con los modelos de DeepSeek o cualquier API compatible, y una versión preliminar para desarrolladores te sirve.",
  ),
  rows: [
    text(
      "An agent harness where every part, from the model to the interface, is a plugin. A developer preview.",
      "Un arnés de agentes donde cada parte, del modelo a la interfaz, es un plugin. Una versión preliminar para desarrolladores.",
    ),
    text(
      "A local web interface started with one command, plus a desktop app, command-line modes and a Python SDK.",
      "Una interfaz web local que arranca con un comando, más una app de escritorio, modos de terminal y un SDK de Python.",
    ),
    text(
      "On your computer, in the workspace folder you pick; it can be published behind a reverse proxy. Its safety notice recommends a disposable VM or container.",
      "En tu computadora, en la carpeta de trabajo que elijas; se puede publicar detrás de un proxy inverso. Su aviso de seguridad recomienda una VM o un contenedor descartable.",
    ),
    text(
      "Delegates to subagents, with team tools that add shared tasks.",
      "Delega en subagentes, con herramientas de equipo que suman tareas compartidas.",
    ),
    text(
      "Sessions are kept; long-term memory comes from a memory MCP server you connect yourself.",
      "Las sesiones se guardan; la memoria de largo plazo viene de un servidor MCP de memoria que conectás vos.",
    ),
    text(
      "Reminders and automation tasks that deliver an instruction to a conversation on a schedule.",
      "Recordatorios y tareas automáticas que entregan una instrucción a una conversación según un horario.",
    ),
    text(
      "DeepSeek's API, Anthropic, OpenAI, Kimi, GLM and any OpenAI-, Anthropic- or Gemini-compatible endpoint; MCP, skills and plugin indexes.",
      "La API de DeepSeek, Anthropic, OpenAI, Kimi, GLM y cualquier endpoint compatible con OpenAI, Anthropic o Gemini; MCP, skills e índices de plugins.",
    ),
    text("MIT. Model APIs are billed by their providers.", "MIT. Las APIs de modelos las cobra cada proveedor."),
  ],
  detail: text(
    "DeepSeek Harness gives you the parts of an agent and lets you swap any of them; its own README warns of breaking changes during the preview. APX gives you the finished office: named agents per project, tasks, routines and Flows, channels where they answer you and your contacts, and a phone app. If you mainly want to build your own agent runtime, Harness is the more open base; if you want a crew working this week, APX starts there.",
    "DeepSeek Harness te da las piezas de un agente y te deja cambiar cualquiera; su propio README avisa que habrá cambios que rompen compatibilidad durante la versión preliminar. APX te da la oficina terminada: agentes con nombre por proyecto, tareas, rutinas y Flows, canales donde te responden a vos y a tus contactos, y una app para el celular. Si lo que querés es armar tu propio motor de agentes, Harness es la base más abierta; si querés una crew trabajando esta semana, APX empieza ahí.",
  ),
  tryIt: text(
    "Give both the same repository and a weekly reminder to review it. Check how long setup takes, what you had to configure and where you read the result.",
    "Dales a los dos el mismo repositorio y un recordatorio semanal para revisarlo. Fijate cuánto tarda la puesta en marcha, qué tuviste que configurar y dónde leés el resultado.",
  ),
};
