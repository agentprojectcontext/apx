import { type Product, text } from "./shared.ts";

export const claudeCowork: Product = {
  slug: "claude-cowork",
  name: "Claude Cowork",
  logo: "claude-cowork.svg",
  source: "https://claude.com/product/cowork",
  detailSource: "https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile",
  license: "https://www.anthropic.com/legal/consumer-terms",
  sources: [
    { title: "Claude Cowork product page", url: "https://claude.com/product/cowork" },
    {
      title: "Get started with Claude Cowork",
      url: "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
    },
    {
      title: "Claude Cowork architecture overview",
      url: "https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview",
    },
    {
      title: "Use Claude Cowork on web, desktop and mobile",
      url: "https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile",
    },
    {
      title: "Organize your tasks with projects in Claude Cowork",
      url: "https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork",
    },
    {
      title: "Schedule recurring tasks in Claude Cowork",
      url: "https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork",
    },
    {
      title: "Use Claude Cowork on Team and Enterprise plans",
      url: "https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans",
    },
    {
      title: "Use Claude Cowork safely",
      url: "https://support.claude.com/en/articles/13364135-use-claude-cowork-safely",
    },
    {
      title: "Use the built-in browser in Claude Cowork",
      url: "https://support.claude.com/en/articles/16607400-use-the-built-in-browser-in-claude-cowork",
    },
    { title: "Claude Tag overview", url: "https://claude.com/docs/claude-tag/overview" },
    { title: "Knowledge work plugins (GitHub)", url: "https://github.com/anthropics/knowledge-work-plugins" },
    { title: "Claude pricing", url: "https://claude.com/pricing" },
    { title: "Anthropic consumer terms", url: "https://www.anthropic.com/legal/consumer-terms" },
    {
      title: "Claude data retention",
      url: "https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data",
    },
    { title: "Cowork is now Claude (blog)", url: "https://claude.com/blog/cowork-is-now-claude" },
    { title: "Cowork for enterprise (blog)", url: "https://claude.com/blog/cowork-for-enterprise" },
  ],
  rowSources: [
    [
      "https://claude.com/product/cowork",
      "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
    ],
    [
      "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
      "https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile",
    ],
    [
      "https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview",
      "https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile",
    ],
    [
      "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
      "https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork",
    ],
    [
      "https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork",
      "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
    ],
    [
      "https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork",
      "https://claude.com/docs/claude-tag/overview",
    ],
    [
      "https://claude.com/pricing",
      "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
      "https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans",
      "https://github.com/anthropics/knowledge-work-plugins",
    ],
    [
      "https://www.anthropic.com/legal/consumer-terms",
      "https://claude.com/pricing",
      "https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork",
    ],
  ],
  short: text("Claude on your files", "Claude con tus archivos"),
  tagline: text(
    "A crew for your projects or Claude on your files?",
    "¿Un equipo para tus proyectos o Claude con tus archivos?",
  ),
  intro: text(
    "Both hand multi-step work to AI agents, with projects, skills and scheduled tasks. Claude Cowork is Anthropic's agent for knowledge work inside Claude; APX organizes a named crew per project and can run Claude Code as one of its harnesses, so the two can work side by side.",
    "Ambos le encargan trabajo de varios pasos a agentes de IA, con proyectos, habilidades y tareas programadas. Claude Cowork es el agente de Anthropic para trabajo de conocimiento dentro de Claude; APX organiza un equipo con nombre por proyecto y puede usar Claude Code como uno de sus harnesses, así que los dos pueden convivir.",
  ),
  choice: text(
    "You want Anthropic's own agent for documents, research and files, running in Anthropic's cloud with plugins, connectors and organization controls.",
    "Querés el agente propio de Anthropic para documentos, investigación y archivos, corriendo en la nube de Anthropic con plugins, conectores y controles para organizaciones.",
  ),
  rows: [
    text(
      "Agentic knowledge work inside Claude: research, analysis, documents and file tasks.",
      "Trabajo de conocimiento con agentes dentro de Claude: investigación, análisis, documentos y tareas con archivos.",
    ),
    text(
      "Claude Desktop for macOS, Windows and Linux (beta); web, mobile apps and the Chrome side panel.",
      "Claude Desktop para macOS, Windows y Linux (beta); web, apps móviles y el panel lateral de Chrome.",
    ),
    text(
      "By default in an isolated sandbox on Anthropic's servers, saved to your Claude account; the desktop app reaches local folders and the browser.",
      "Por defecto en un entorno aislado en servidores de Anthropic, guardado en tu cuenta de Claude; la app de escritorio accede a carpetas locales y al navegador.",
    ),
    text(
      "Subagents split work into parallel streams; projects can be shared on Team and Enterprise, sessions cannot.",
      "Subagentes reparten el trabajo en tareas paralelas; los proyectos se pueden compartir en Team y Enterprise, las sesiones no.",
    ),
    text(
      "Projects with their own files, instructions and memory; account memory; skills bundled in plugins.",
      "Proyectos con archivos, instrucciones y memoria propios; memoria de la cuenta; habilidades incluidas en plugins.",
    ),
    text(
      "Cloud scheduled tasks hourly, daily, weekly or on weekdays. Slack work is a separate product, Claude Tag, on Team and Enterprise.",
      "Tareas programadas en la nube por hora, día, semana o días hábiles. El trabajo en Slack es otro producto, Claude Tag, en Team y Enterprise.",
    ),
    text(
      "Anthropic's Claude models; MCP connectors and plugins that bundle skills, connectors and subagents; organization plugin marketplaces.",
      "Modelos Claude de Anthropic; conectores MCP y plugins que reúnen habilidades, conectores y subagentes; catálogos de plugins por organización.",
    ),
    text(
      "Proprietary service under Anthropic's terms. Needs a paid plan, from Pro at $20/month ($17/month billed annually); usage limits apply.",
      "Servicio propietario bajo los términos de Anthropic. Requiere un plan pago, desde Pro a USD 20 por mes (USD 17 con pago anual); hay límites de uso.",
    ),
  ],
  detail: text(
    "Cowork brings Claude Code's agent design to knowledge work, and since October 6, 2026, new Pro and Max sessions run in Anthropic's cloud, so tasks continue with your laptop closed. APX runs on your computer or a server you control, with named agents, a task board and chat channels such as Telegram. APX can use Claude Code as a harness, so choosing one does not rule out the other.",
    "Cowork lleva el diseño de agentes de Claude Code al trabajo de conocimiento y, desde el 6 de octubre de 2026, las sesiones nuevas en Pro y Max corren en la nube de Anthropic, así que las tareas siguen con la computadora cerrada. APX corre en tu computadora o en un servidor que controlás, con agentes con nombre, un tablero de tareas y canales de chat como Telegram. APX puede usar Claude Code como harness, así que elegir uno no descarta el otro.",
  ),
  tryIt: text(
    "Give both the same weekly report built from a folder of documents and let it run for a month. Compare where files and history end up, how you approve actions and how you review each run.",
    "Dales a los dos el mismo informe semanal armado con una carpeta de documentos y dejalo correr un mes. Compará dónde quedan los archivos y el historial, cómo aprobás acciones y cómo revisás cada ejecución.",
  ),
};
