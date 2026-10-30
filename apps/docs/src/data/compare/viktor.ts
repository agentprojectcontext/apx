import { type Product, text } from "./shared.ts";

export const viktor: Product = {
  slug: "viktor",
  name: "Viktor",
  logo: "viktor.png",
  source: "https://viktor.com/",
  detailSource: "https://viktor.com/security",
  license: "https://viktor.com/legal/general-terms",
  sources: [
    { title: "Viktor home page", url: "https://viktor.com/" },
    { title: "Viktor pricing", url: "https://viktor.com/pricing" },
    { title: "Viktor security", url: "https://viktor.com/security" },
    { title: "Viktor changelog", url: "https://viktor.com/changelog" },
    { title: "Viktor approvals", url: "https://viktor.com/docs/approvals" },
    { title: "What Viktor can do", url: "https://viktor.com/docs/what-viktor-can-do" },
    { title: "Viktor general terms", url: "https://viktor.com/legal/general-terms" },
  ],
  rowSources: [
    ["https://viktor.com/", "https://viktor.com/docs/what-viktor-can-do"],
    ["https://viktor.com/", "https://viktor.com/changelog"],
    ["https://viktor.com/security"],
    ["https://viktor.com/", "https://viktor.com/docs/what-viktor-can-do", "https://viktor.com/docs/approvals"],
    ["https://viktor.com/", "https://viktor.com/changelog"],
    ["https://viktor.com/pricing", "https://viktor.com/changelog"],
    ["https://viktor.com/security", "https://viktor.com/changelog", "https://viktor.com/"],
    ["https://viktor.com/legal/general-terms", "https://viktor.com/pricing"],
  ],
  short: text("AI teammate in Slack", "compañero de IA en Slack"),
  tagline: text("Your own crew or an AI teammate in Slack?", "¿Tu propio equipo o un compañero de IA en Slack?"),
  intro: text(
    "Both take on real work, keep context and run scheduled tasks. APX runs on hardware you control with a crew per project; Viktor is a hosted AI employee that your team uses from Slack, Microsoft Teams, Discord or its web app.",
    "Ambos hacen trabajo concreto, conservan contexto y ejecutan tareas programadas. APX corre en equipos que controlás, con un equipo por proyecto; Viktor es un empleado de IA alojado que tu equipo usa desde Slack, Microsoft Teams, Discord o su app web.",
  ),
  choice: text(
    "You want one shared AI teammate inside your team's Slack or Teams, hosted for you, with a large integration catalog and admin-controlled approvals.",
    "Querés un compañero de IA compartido dentro del Slack o Teams de tu equipo, alojado por ellos, con un catálogo amplio de integraciones y aprobaciones que controla un administrador.",
  ),
  rows: [
    text(
      "An AI employee that carries out operational work such as reports, dashboards, code and campaigns.",
      "Un empleado de IA que hace trabajo operativo como informes, tableros, código y campañas.",
    ),
    text(
      "Slack and Microsoft Teams, plus Discord and a web app.",
      "Slack y Microsoft Teams, además de Discord y una app web.",
    ),
    text(
      "Viktor's cloud on AWS us-east-1, a sandboxed environment per workspace; EU data residency on Enterprise.",
      "La nube de Viktor en AWS us-east-1, con un entorno aislado por espacio de trabajo; residencia de datos en la UE con Enterprise.",
    ),
    text(
      "One shared instance per workspace that anyone can mention; up to 8 helpers for parallel jobs; approval cards.",
      "Una instancia compartida por espacio de trabajo a la que cualquiera puede mencionar; hasta 8 ayudantes en paralelo; tarjetas de aprobación.",
    ),
    text(
      "Workspace memory, skills it records from channels it joins, and standing instructions.",
      "Memoria del espacio de trabajo, habilidades que registra en los canales donde participa e instrucciones permanentes.",
    ),
    text(
      "Scheduled tasks you can pause and resume; works inside your team's chat channels.",
      "Tareas programadas que podés pausar y retomar; trabaja dentro de los canales de chat de tu equipo.",
    ),
    text(
      "Claude, GPT, Gemini and other models from its catalog; thousands of integrations, MCP server and compatible API.",
      "Claude, GPT, Gemini y otros modelos de su catálogo; miles de integraciones, servidor MCP y API compatible.",
    ),
    text(
      "Proprietary, credit-based: Free with up to $100 in credits, Team from $50/month, Enterprise custom.",
      "Propietario, por créditos: Free con hasta USD 100 en créditos, Team desde USD 50 por mes y Enterprise a medida.",
    ),
  ],
  detail: text(
    "Viktor is a hosted service: work runs in its cloud, and your team reaches it through the chat tools it already uses. APX is MIT software you run on your computer or server, with several named agents organized by project. Both keep memory, schedule work and ask before sensitive actions, so the real question is who hosts the work and whether you want one shared teammate or a crew per project.",
    "Viktor es un servicio alojado: el trabajo corre en su nube y tu equipo lo usa desde las herramientas de chat que ya tiene. APX es software MIT que corrés en tu computadora o servidor, con varios agentes con identidad organizados por proyecto. Ambos conservan memoria, programan trabajo y piden confirmación antes de acciones sensibles, así que la pregunta real es quién aloja el trabajo y si querés un compañero compartido o un equipo por proyecto.",
  ),
  tryIt: text(
    "Ask each one for a weekly report from a tool you already use, delivered to a team chat. Compare setup, approvals, where the data lives and the cost of a month of runs.",
    "Pedile a cada uno un informe semanal a partir de una herramienta que ya usás, entregado en un chat del equipo. Compará la configuración, las aprobaciones, dónde quedan los datos y el costo de un mes de ejecuciones.",
  ),
};
