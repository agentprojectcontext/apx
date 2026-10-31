import { text } from "../compare/shared.ts";

export const hostedApps = [
  {
    slug: "claude-cowork",
    name: "Claude Cowork",
    group: "hosted",
    logo: "claude-cowork.svg",
    comparePage: "claude-cowork",
    bestFor: text(
      "Documents, research and files inside Claude",
      "Documentos, investigación y archivos dentro de Claude",
    ),
    runsOn: text(
      "Anthropic's cloud; Claude Desktop, web and mobile apps",
      "La nube de Anthropic; Claude Desktop, web y apps móviles",
    ),
    models: text(
      "Anthropic's Claude models; MCP connectors and plugins",
      "Modelos Claude de Anthropic; conectores MCP y plugins",
    ),
    price: text(
      "Paid Claude plan, from Pro at $20/month; usage limits apply.",
      "Plan pago de Claude, desde Pro a USD 20/mes, con límites.",
    ),
    summary: text(
      "Anthropic's agent for knowledge work: research, analysis, documents and file tasks. By default it runs in an isolated sandbox on Anthropic's servers, with projects, memory, plugins and scheduled tasks; the desktop app can reach your local folders.",
      "El agente de Anthropic para trabajo de conocimiento: investigación, análisis, documentos y tareas con archivos. Por defecto corre en un entorno aislado en servidores de Anthropic, con proyectos, memoria, plugins y tareas programadas; la app de escritorio llega a tus carpetas locales.",
    ),
    chooseIf: text(
      "You already pay for Claude and want its agent for documents and research.",
      "Ya pagás Claude y querés su agente para documentos e investigación.",
    ),
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
  },
  {
    slug: "chatgpt-dots",
    name: "ChatGPT dots",
    group: "hosted",
    logo: "chatgpt-dots.svg",
    comparePage: "chatgpt-dots",
    bestFor: text("One always-on agent for ChatGPT users", "Un agente siempre activo para quien usa ChatGPT"),
    runsOn: text(
      "OpenAI's cloud computer; ChatGPT apps, Slack and Teams",
      "Nube de OpenAI; apps de ChatGPT, Slack y Teams",
    ),
    models: text("OpenAI models; ChatGPT plugins", "Modelos de OpenAI; plugins de ChatGPT"),
    price: text(
      "Included in ChatGPT Pro (from $100/month) and Business Premium.",
      "Incluido en ChatGPT Pro (desde USD 100/mes) y Business Premium.",
    ),
    summary: text(
      "One always-on agent per person that takes on ongoing goals and keeps working between conversations, on its own cloud computer and browser run by OpenAI. It starts from your ChatGPT memory and is reachable from ChatGPT, Slack and Teams; it is not offered in the EEA, Switzerland or the UK.",
      "Un agente siempre activo por persona que toma objetivos de largo plazo y sigue trabajando entre conversaciones, en su propia computadora y navegador en la nube de OpenAI. Parte de tu memoria de ChatGPT y lo usás desde ChatGPT, Slack y Teams; no está disponible en el EEE, Suiza ni el Reino Unido.",
    ),
    chooseIf: text(
      "You live in ChatGPT and want one agent that keeps working with your ChatGPT memory.",
      "Vivís en ChatGPT y querés un agente que siga trabajando con tu memoria de ChatGPT.",
    ),
    sources: [
      { title: "Introducing dots (OpenAI)", url: "https://openai.com/index/introducing-dots/" },
      {
        title: "Getting started with your dot",
        url: "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      },
      {
        title: "Dots privacy, security and safety FAQs",
        url: "https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs",
      },
      { title: "About ChatGPT Pro tiers", url: "https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers" },
      { title: "ChatGPT dots", url: "https://chatgpt.com/features/dots/" },
    ],
  },
  {
    slug: "manus",
    name: "Manus",
    group: "hosted",
    logo: "manus.png",
    comparePage: "manus",
    bestFor: text("Finished reports, slides, sites and videos", "Informes, diapositivas, sitios y videos terminados"),
    runsOn: text(
      "Manus' cloud; web, desktop and mobile apps, Slack, Telegram",
      "Nube de Manus; web, escritorio, móvil, Slack, Telegram",
    ),
    models: text("Manus' own model options; MCP connectors", "Opciones de modelo propias de Manus; conectores MCP"),
    price: text(
      "Free with 300 daily credits; Pro from $20/month.",
      "Free con 300 créditos diarios; Pro desde USD 20/mes.",
    ),
    summary: text(
      "A hosted general agent that turns a request into a deliverable such as research, slides, a website or a video. It adds projects, skills, scheduled automations, parallel agents and a desktop bridge to folders you authorize, billed in credits.",
      "Un agente general alojado que convierte un pedido en un entregable, como una investigación, diapositivas, un sitio o un video. Suma proyectos, habilidades, automatizaciones programadas, agentes en paralelo y un puente de escritorio a carpetas que autorizás, y se cobra en créditos.",
    ),
    chooseIf: text(
      "You want finished deliverables from one request, with nothing to set up.",
      "Querés entregables terminados a partir de un pedido, sin nada que instalar.",
    ),
    sources: [
      { title: "Manus home", url: "https://manus.im/" },
      { title: "Introducing Manus 2.0", url: "https://manus.im/blog/introducing-manus-2-0" },
      {
        title: "Manus membership pricing (help center)",
        url: "https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus",
      },
      { title: "Manus Team plan", url: "https://manus.im/team" },
      {
        title: "Manus resumes independent operations",
        url: "https://manus.im/blog/manus-resumes-independent-operations",
      },
      { title: "Manus Desktop and My Computer", url: "https://manus.im/docs/features/desktop" },
      { title: "Manus Cloud Computer", url: "https://help.manus.im/en/articles/15392111-what-is-the-cloud-computer" },
      { title: "Manus Wide Research", url: "https://manus.im/docs/features/wide-research" },
      { title: "Manus Collab", url: "https://help.manus.im/en/articles/12135428-how-can-i-use-manus-collab" },
      { title: "Manus Projects", url: "https://manus.im/docs/features/projects.md" },
      { title: "Manus Skills", url: "https://manus.im/docs/features/skills.md" },
      { title: "Manus automations", url: "https://manus.im/docs/automations.md" },
      { title: "Manus Agents in Telegram", url: "https://manus.im/blog/manus-agents-telegram" },
      {
        title: "Manus Agents in Slack",
        url: "https://help.manus.im/en/articles/14432468-how-do-i-set-up-connect-and-use-manus-agents-in-slack",
      },
      { title: "Manus MCP connectors", url: "https://manus.im/docs/integrations/mcp-connectors" },
    ],
  },
  {
    slug: "grok-bot",
    name: "Grok Bot",
    group: "hosted",
    logo: "grok-bot.png",
    comparePage: "grok-bot",
    bestFor: text("Hosted Bots that work while your laptop sleeps", "Bots alojados que trabajan con tu compu cerrada"),
    runsOn: text("A cloud computer in the US; desktop, mobile, X", "Una computadora en la nube; escritorio, móvil y X"),
    models: text("Picks the model per task; apps and custom MCP", "Elige el modelo por tarea; apps y MCP propios"),
    price: text(
      "Included with X Premium ($30/month), Super ($100) and Ultra ($200).",
      "En X Premium (USD 30/mes), Super (100) y Ultra (200).",
    ),
    summary: text(
      "Persistent Bots with names and roles that work through multi-step tasks on a shared cloud computer. They run in parallel, message each other, keep summaries of past work and run routines on schedules or triggers from Slack, GitHub, email and webhooks.",
      "Bots persistentes con nombre y rol que resuelven tareas de varios pasos en una computadora en la nube compartida. Trabajan en paralelo, se escriben entre sí, guardan resúmenes de lo hecho y corren rutinas por horario o por eventos de Slack, GitHub, correo y webhooks.",
    ),
    chooseIf: text(
      "You want hosted Bots with event triggers that keep working while your computer is off.",
      "Querés Bots alojados con disparadores que sigan trabajando con tu computadora apagada.",
    ),
    sources: [
      { title: "Grok Bot", url: "https://x.ai/bot" },
      { title: "Grok Bot overview", url: "https://docs.x.ai/grok-bot/overview" },
      { title: "Grok Bot get started", url: "https://docs.x.ai/grok-bot/get-started" },
      { title: "Grok Bot computer and apps", url: "https://docs.x.ai/grok-bot/computer-and-apps" },
      { title: "Grok Bot chat and collaboration", url: "https://docs.x.ai/grok-bot/chat-and-collaboration" },
      {
        title: "Grok Bot skills, routines and automations",
        url: "https://docs.x.ai/grok-bot/skills-routines-and-automations",
      },
      { title: "Grok Bot Teams and Enterprise", url: "https://docs.x.ai/grok-bot/teams-and-enterprises" },
      { title: "Grok Bot security", url: "https://docs.x.ai/grok-bot/security" },
      { title: "Grok Bot FAQ", url: "https://docs.x.ai/grok-bot/faq" },
      { title: "Grok Bot plans and billing (Cursor help)", url: "https://cursor.com/help/grok-bot/plans" },
    ],
  },
  {
    slug: "viktor",
    name: "Viktor",
    group: "hosted",
    logo: "viktor.png",
    comparePage: "viktor",
    bestFor: text("One shared AI teammate in Slack or Teams", "Un compañero de IA en Slack o Teams"),
    runsOn: text(
      "Viktor's cloud; Slack, Microsoft Teams, Discord and web",
      "La nube de Viktor; Slack, Microsoft Teams, Discord y web",
    ),
    models: text(
      "Claude, GPT, Gemini and others; MCP and integrations",
      "Claude, GPT, Gemini y otros; MCP e integraciones",
    ),
    price: text(
      "Free with up to $100 in credits; Team from $50/month.",
      "Free con hasta USD 100 en créditos; Team desde USD 50/mes.",
    ),
    summary: text(
      "A hosted AI employee for operational work such as reports, dashboards, code and campaigns, shared by a whole workspace in Slack or Teams. It keeps workspace memory, records skills, runs scheduled tasks and asks for approvals.",
      "Un empleado de IA alojado para trabajo operativo como informes, tableros, código y campañas, compartido por todo un espacio de trabajo en Slack o Teams. Guarda memoria del espacio, registra habilidades, corre tareas programadas y pide aprobaciones.",
    ),
    chooseIf: text(
      "You want one shared teammate inside your team's chat, hosted for you.",
      "Querés un compañero compartido dentro del chat de tu equipo, alojado por otro.",
    ),
    sources: [
      { title: "Viktor home page", url: "https://viktor.com/" },
      { title: "Viktor pricing", url: "https://viktor.com/pricing" },
      { title: "Viktor security", url: "https://viktor.com/security" },
      { title: "Viktor changelog", url: "https://viktor.com/changelog" },
      { title: "Viktor approvals", url: "https://viktor.com/docs/approvals" },
      { title: "What Viktor can do", url: "https://viktor.com/docs/what-viktor-can-do" },
      { title: "Viktor general terms", url: "https://viktor.com/legal/general-terms" },
    ],
  },
  {
    slug: "muse",
    name: "Muse",
    group: "hosted",
    logo: "muse.svg",
    comparePage: "muse",
    bestFor: text("Personal errands and life tasks", "Trámites y tareas personales"),
    runsOn: text(
      "A cloud VM run by Meta; mobile, web, WhatsApp, Mac",
      "Una VM de Meta en la nube; móvil, web, WhatsApp",
    ),
    models: text(
      "Meta's Muse Spark model; built-in and custom connectors",
      "Muse Spark de Meta; conectores propios y a medida",
    ),
    price: text(
      "Free with a weekly limit; Power $20/month; Maximum $100/month.",
      "Gratis con límite semanal; Power USD 20/mes; Maximum USD 100/mes.",
    ),
    summary: text(
      "Meta's personal agent for goals, tasks and errands, such as sending emails or booking travel. It runs on a dedicated cloud machine per person, keeps memory you can inspect and edit, and you reach it in the Muse app or WhatsApp.",
      "El agente personal de Meta para objetivos, tareas y trámites, como mandar correos o reservar viajes. Corre en una máquina en la nube dedicada para cada persona, guarda memoria que podés revisar y editar, y le hablás desde la app de Muse o WhatsApp.",
    ),
    chooseIf: text(
      "You want a personal agent for errands that you message in WhatsApp.",
      "Querés un agente personal para trámites al que le escribís por WhatsApp.",
    ),
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
      {
        title: "Muse subscription plans (Meta help)",
        url: "https://www.meta.com/help/subscriptions/1021145227643680/",
      },
      { title: "Using Muse (Meta help)", url: "https://www.meta.com/help/artificial-intelligence/1331373868832401/" },
      { title: "Muse privacy policy", url: "https://muse.ai/privacy" },
      { title: "Muse supplemental terms", url: "https://muse.ai/terms" },
    ],
  },
  {
    slug: "instinct",
    name: "Instinct",
    group: "hosted",
    logo: "instinct.png",
    comparePage: "instinct",
    bestFor: text("An assistant you text or call", "Un asistente al que le escribís o llamás"),
    runsOn: text("A hosted US service; text, calls, web and Mac", "Servicio alojado; mensajes, llamadas, web y Mac"),
    models: text(
      "Unnamed third-party language models; Apple, Google, Facebook accounts",
      "Modelos de terceros sin nombre; cuentas de Apple, Google, Facebook",
    ),
    price: text(
      "Some features are paid; no public price list.",
      "Algunas funciones son pagas; no hay lista de precios pública.",
    ),
    summary: text(
      "A personal assistant that takes actions on everyday tasks, reached by text message or phone call, with a web app and a Mac app. It indexes data from the accounts you connect and keeps a Vault for your materials.",
      "Un asistente personal que hace cosas por vos en tareas cotidianas, al que le escribís o llamás por teléfono, con app web y app para Mac. Indexa datos de las cuentas que conectás y guarda tus materiales en una Vault.",
    ),
    chooseIf: text(
      "You want one assistant for errands by text or call, with no new interface to learn.",
      "Querés un asistente para trámites por mensaje o llamada, sin aprender una interfaz nueva.",
    ),
    sources: [
      { title: "Instinct home page", url: "https://instinct.com/" },
      { title: "Instinct terms of service", url: "https://instinct.com/terms" },
      { title: "Instinct privacy policy", url: "https://instinct.com/privacy-policy" },
      { title: "Instinct app", url: "https://app.instinct.com/" },
      {
        title: "TechCrunch on Instinct privacy and security concerns (press)",
        url: "https://techcrunch.com/2026/08/24/instincts-powerful-ai-assistant-is-raising-privacy-and-security-concerns/",
      },
    ],
  },
];
