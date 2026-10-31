import { type Product, text } from "./shared.ts";

export const paperclip: Product = {
  slug: "paperclip",
  name: "Paperclip",
  logo: "paperclip.png",
  source: "https://paperclip.ing/",
  detailSource: "https://github.com/paperclipai/paperclip",
  license: "https://github.com/paperclipai/paperclip/blob/76fde891ccc29283b3f5c8dcdce089c5b3d937d1/LICENSE",
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
  rowSources: [
    ["https://paperclip.ing/", "https://paperclip.ing/llms.txt"],
    ["https://github.com/paperclipai/paperclip", "https://docs.paperclip.ing/"],
    [
      "https://paperclip.ing/llms.txt",
      "https://github.com/paperclipai/paperclip/blob/76fde891ccc29283b3f5c8dcdce089c5b3d937d1/docs/deploy/deployment-modes.md",
    ],
    ["https://github.com/paperclipai/paperclip", "https://docs.paperclip.ing/how-to/enable-multi-user-login/"],
    ["https://github.com/paperclipai/paperclip", "https://docs.paperclip.ing/connectors/"],
    ["https://github.com/paperclipai/paperclip", "https://docs.paperclip.ing/connectors/"],
    [
      "https://paperclip.ing/llms.txt",
      "https://docs.paperclip.ing/connectors/",
      "https://docs.paperclip.ing/adapters/claude-local",
    ],
    [
      "https://github.com/paperclipai/paperclip/blob/76fde891ccc29283b3f5c8dcdce089c5b3d937d1/LICENSE",
      "https://github.com/paperclipai/paperclip",
    ],
  ],
  short: text("agent company", "empresa de agentes"),
  tagline: text("A project crew or an agent company?", "¿Un equipo por proyecto o una empresa de agentes?"),
  intro: text(
    "Both are open source, self-hosted and can run Claude Code, Codex and other agents on tracked tasks. APX organizes a crew around your projects; Paperclip models an AI company with an org chart, goals, budgets and approvals.",
    "Ambos son de código abierto, se instalan en tus propios equipos y pueden poner a Claude Code, Codex y otros agentes a trabajar en tareas con seguimiento. APX organiza un equipo alrededor de tus proyectos; Paperclip arma una empresa de IA con organigrama, objetivos, presupuestos y aprobaciones.",
  ),
  choice: text(
    "You want to run business goals through an org chart of agents, with budgets per company, project and agent, and approval gates you control.",
    "Querés llevar objetivos de negocio con un organigrama de agentes, presupuestos por empresa, proyecto y agente, y aprobaciones que controlás.",
  ),
  rows: [
    text(
      "Orchestrating a team of agents as a company: goals, org chart, tasks and governance.",
      "Coordinar un equipo de agentes como una empresa: objetivos, organigrama, tareas y control.",
    ),
    text(
      "Web dashboard served by a Node.js server, usable from a phone browser; CLI and API.",
      "Panel web servido por un servidor Node.js, usable desde el navegador del teléfono; CLI y API.",
    ),
    text(
      "Self-hosted on your laptop, Docker or a server, with embedded or your own Postgres. No Paperclip account required.",
      "En tu laptop, Docker o un servidor propio, con Postgres incluido o el tuyo. No requiere cuenta de Paperclip.",
    ),
    text(
      "Roles and reporting lines, delegation through the org chart, approvals; teammates can sign in with authenticated mode.",
      "Roles y líneas de reporte, delegación por el organigrama y aprobaciones; tu equipo puede iniciar sesión en el modo con autenticación.",
    ),
    text(
      "Goals linked to projects and tasks, versioned skills; built-in memory is on the roadmap, with experimental memory connectors.",
      "Objetivos ligados a proyectos y tareas, habilidades con versiones; la memoria propia está en desarrollo, con conectores de memoria experimentales.",
    ),
    text(
      "Heartbeats and routines on cron, webhook or API triggers; experimental chat channels such as Slack, Discord and Telegram.",
      "Heartbeats y rutinas por cron, webhook o API; canales de chat experimentales como Slack, Discord y Telegram.",
    ),
    text(
      "Claude Code, Codex, Gemini CLI, OpenCode, Hermes, OpenClaw and more; plugins, custom MCP servers and app connectors.",
      "Claude Code, Codex, Gemini CLI, OpenCode, Hermes, OpenClaw y más; plugins, servidores MCP propios y conectores de apps.",
    ),
    text(
      "MIT. A cloud version has a waitlist; agent and model usage can cost extra.",
      "MIT. La versión en la nube tiene lista de espera; el uso de agentes y modelos puede tener costos aparte.",
    ),
  ],
  detail: text(
    "Paperclip treats agents as employees of a company: each has a boss, a role and a budget, and work moves through approvals and spend limits. APX centers named agents on your projects, with memory, routines and chat channels for day-to-day work. Both delegate, track tasks and run coding agents such as Claude Code and Codex, so the choice is about the shape of the work, not about having a team.",
    "Paperclip trata a los agentes como empleados de una empresa: cada uno tiene jefe, rol y presupuesto, y el trabajo pasa por aprobaciones y límites de gasto. APX pone a los agentes con identidad al servicio de tus proyectos, con memoria, rutinas y canales de chat para el trabajo diario. Ambos delegan, siguen tareas y usan agentes de código como Claude Code y Codex, así que la elección es sobre la forma del trabajo, no sobre tener o no un equipo.",
  ),
  tryIt: text(
    "Give both the same goal, such as a weekly market brief, using Claude Code as the agent. Compare how you approve the plan, cap spending and find the result a week later.",
    "Dales a ambos el mismo objetivo, como un informe semanal de mercado, con Claude Code como agente. Compará cómo aprobás el plan, limitás el gasto y encontrás el resultado una semana después.",
  ),
};
