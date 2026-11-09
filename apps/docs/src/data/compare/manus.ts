import { type Product, text } from "./shared.ts";

export const manus: Product = {
  slug: "manus",
  name: "Manus",
  logo: "manus.png",
  source: "https://manus.im/",
  detailSource: "https://manus.im/blog/introducing-manus-2-0",
  license: "https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus",
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
  rowSources: [
    ["https://manus.im/", "https://manus.im/blog/introducing-manus-2-0"],
    ["https://manus.im/", "https://manus.im/docs/features/desktop", "https://manus.im/blog/manus-agents-telegram"],
    ["https://help.manus.im/en/articles/15392111-what-is-the-cloud-computer", "https://manus.im/docs/features/desktop"],
    [
      "https://manus.im/docs/features/wide-research",
      "https://help.manus.im/en/articles/12135428-how-can-i-use-manus-collab",
      "https://manus.im/team",
    ],
    ["https://manus.im/docs/features/projects.md", "https://manus.im/docs/features/skills.md"],
    [
      "https://manus.im/docs/automations.md",
      "https://manus.im/blog/manus-agents-telegram",
      "https://help.manus.im/en/articles/14432468-how-do-i-set-up-connect-and-use-manus-agents-in-slack",
    ],
    ["https://manus.im/blog/manus-agents-telegram", "https://manus.im/docs/integrations/mcp-connectors"],
    [
      "https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus",
      "https://manus.im/team",
    ],
  ],
  short: text("general agent in the cloud", "agente general en la nube"),
  tagline: text(
    "A project crew or a general agent in the cloud?",
    "¿Un equipo por proyecto o un agente general en la nube?",
  ),
  intro: text(
    "Both handle research, recurring work, skills and chat channels. Manus is a hosted agent that turns a request into a finished deliverable such as a report, slides, a website or a video; APX keeps a named crew working on your projects from your own computer or server.",
    "Ambos resuelven investigación, trabajo recurrente, habilidades y canales de chat. Manus es un agente alojado que convierte un pedido en un entregable terminado, como un informe, diapositivas, un sitio o un video; APX mantiene un equipo con nombre trabajando en tus proyectos desde tu computadora o servidor.",
  ),
  choice: text(
    "You want a hosted agent that delivers finished research, slides, sites or videos from one request, with nothing to set up.",
    "Querés un agente alojado que entregue investigaciones, diapositivas, sitios o videos terminados a partir de un pedido, sin nada que instalar.",
  ),
  rows: [
    text(
      "A general AI agent that produces research, slides, websites, games, videos and other deliverables.",
      "Un agente de IA general que produce investigaciones, diapositivas, sitios, juegos, videos y otros entregables.",
    ),
    text(
      "Web, desktop (macOS and Windows) and mobile apps; Slack, Telegram and an API.",
      "Apps web, de escritorio (macOS y Windows) y móvil; Slack, Telegram y una API.",
    ),
    text(
      "Cloud sandbox by default, or a persistent Cloud Computer. Studio's Work locally mode executes tasks on your computer while Manus plans in the cloud; some features upload files or temporarily switch to cloud execution.",
      "Entorno en la nube por defecto, o una Cloud Computer persistente. El modo Work locally de Studio ejecuta tareas en tu computadora mientras Manus planifica en la nube; algunas funciones suben archivos o cambian temporalmente a ejecución en la nube.",
    ),
    text(
      "Wide Research splits work across parallel agents; a task can be shared with up to 50 people; Team plan shares projects and skills.",
      "Wide Research reparte el trabajo entre agentes en paralelo; una tarea se comparte con hasta 50 personas; el plan Team comparte proyectos y habilidades.",
    ),
    text(
      "Projects with master instructions and a knowledge base; file-based skills you can save from a task, upload or import.",
      "Proyectos con instrucciones principales y una base de conocimiento; habilidades en archivos que podés guardar desde una tarea, subir o importar.",
    ),
    text(
      "Scheduled and event-triggered automations; Manus Agents in Telegram and Slack.",
      "Automatizaciones programadas o disparadas por eventos; Manus Agents en Telegram y Slack.",
    ),
    text(
      "Manus' own model options; prebuilt MCP connectors such as Gmail, Notion and GitHub.",
      "Opciones de modelo propias de Manus; conectores MCP listos, como Gmail, Notion y GitHub.",
    ),
    text(
      "Hosted subscription. Free with 300 daily credits; Pro from $20/month; Team from $20 per seat/month.",
      "Suscripción alojada. Free con 300 créditos diarios; Pro desde USD 20/mes; Team desde USD 20 por puesto/mes.",
    ),
  ],
  detail: text(
    "Manus is built around the deliverable: you describe the outcome and its agent, sandbox and Studio tools produce the file, site or video. It also offers projects, skills, automations and parallel agents, so the difference is not memory or scheduling. Studio offers local execution with cloud planning, and local tasks use the same credits as cloud tasks. APX runs a project crew on hardware you control with the model providers you choose; a cloud model still receives the prompts needed for its requests.",
    "Manus gira alrededor del entregable: describís el resultado y su agente, su entorno en la nube y sus herramientas de Studio producen el archivo, el sitio o el video. También ofrece proyectos, habilidades, automatizaciones y agentes en paralelo, así que la diferencia no es la memoria ni la programación de tareas. Studio ofrece ejecución local con planificación en la nube, y las tareas locales usan los mismos créditos que las tareas en la nube. APX corre un equipo por proyecto en equipos que controlás con los proveedores de modelos que elegís; un modelo en la nube recibe los prompts necesarios para sus pedidos.",
  ),
  tryIt: text(
    "Ask both for the same weekly market brief delivered to Telegram. Compare the result, how you correct it the second week and what each run cost.",
    "Pedile a los dos el mismo informe de mercado semanal enviado a Telegram. Compará el resultado, cómo lo corregís la segunda semana y cuánto costó cada ejecución.",
  ),
};
