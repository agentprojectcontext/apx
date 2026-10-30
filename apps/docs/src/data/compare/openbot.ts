import { type Product, text } from "./shared.ts";

const openbotComparison = "https://openbot.run/compare/hermes-agent";

export const openbot: Product = {
  slug: "openbot",
  name: "OpenBot",
  logo: "openbot.png",
  source: "https://openbot.run/",
  detailSource: "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
  sources: [
    { title: "OpenBot", url: "https://openbot.run/" },
    { title: "OpenBot compared with Hermes Agent", url: openbotComparison },
    {
      title: "OpenBot license",
      url: "https://github.com/nightly-labs/openbot/blob/98e89b61782a2ae7d0aac380d82d824b65179afd/LICENSE",
    },
  ],
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
  short: text("local teammates", "compañeros locales"),
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
};
