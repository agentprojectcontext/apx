import { type Product, text } from "./shared.ts";

export const chatgptDots: Product = {
  slug: "chatgpt-dots",
  name: "ChatGPT dots",
  logo: "chatgpt-dots.svg",
  mono: true,
  source: "https://chatgpt.com/features/dots/",
  detailSource: "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
  license: "https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers",
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
  rowSources: [
    [
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://openai.com/index/introducing-dots/",
    ],
    [
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://openai.com/index/introducing-dots/",
    ],
    [
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs",
    ],
    [
      "https://openai.com/index/introducing-dots/",
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
    ],
    [
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs",
    ],
    [
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://openai.com/index/introducing-dots/",
    ],
    [
      "https://openai.com/index/introducing-dots/",
      "https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs",
    ],
    [
      "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
      "https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers",
      "https://openai.com/index/introducing-dots/",
    ],
  ],
  short: text("always-on agent", "agente siempre activo"),
  tagline: text(
    "A project crew or one always-on agent in ChatGPT?",
    "¿Un equipo por proyecto o un agente activo en ChatGPT?",
  ),
  intro: text(
    "Both keep working between conversations and learn how you work. APX runs a crew of agents on hardware you control; a dot is one always-on agent inside ChatGPT, with its own cloud computer.",
    "Ambos siguen trabajando entre conversaciones y aprenden cómo trabajás. APX corre un equipo de agentes en equipos que controlás; un dot es un agente siempre activo dentro de ChatGPT, con su propia computadora en la nube.",
  ),
  choice: text(
    "You already use ChatGPT and want one always-on agent with its own cloud computer, your ChatGPT memory and plugins, reachable from ChatGPT, Slack or Teams.",
    "Ya usás ChatGPT y querés un agente siempre activo con su propia computadora en la nube, tu memoria y tus plugins de ChatGPT, al que le escribís desde ChatGPT, Slack o Teams.",
  ),
  rows: [
    text(
      "One always-on agent that takes on ongoing goals and keeps making progress between conversations.",
      "Un agente siempre activo que asume objetivos en curso y sigue avanzando entre conversaciones.",
    ),
    text(
      "ChatGPT desktop app, desktop web and iOS and Android apps; also Slack, Teams and voice calls.",
      "App de escritorio de ChatGPT, web en computadora y apps para iOS y Android; también Slack, Teams y llamadas de voz.",
    ),
    text(
      "Its own cloud computer and browser run by OpenAI; access to your own computer is optional and off by default.",
      "Su propia computadora y navegador en la nube de OpenAI; el acceso a tu computadora es opcional y viene desactivado.",
    ),
    text(
      "One dot per person today; it can create Codex and ChatGPT Work tasks. OpenAI previews specialized dots for organizations.",
      "Hoy, un dot por persona; puede crear tareas en Codex y ChatGPT Work. OpenAI ofrece una vista previa de dots especializados para organizaciones.",
    ),
    text(
      "Starts with ChatGPT memory, forms its own memories, including from connected apps; local skills with a connected computer.",
      "Arranca con la memoria de ChatGPT y forma memorias propias, también desde apps conectadas; habilidades locales con una computadora conectada.",
    ),
    text(
      "Reminders, recurring tasks and background research; Slack and Teams, plus a limited texting beta for US Pro users.",
      "Recordatorios, tareas recurrentes e investigación en segundo plano; Slack y Teams, y una beta limitada de SMS para usuarios Pro en EE. UU.",
    ),
    text(
      "OpenAI models (launched with GPT-6 Astra); ChatGPT plugins shared with ChatGPT, Work and Codex.",
      "Modelos de OpenAI (se lanzó con GPT-6 Astra); plugins de ChatGPT compartidos con ChatGPT, Work y Codex.",
    ),
    text(
      "Proprietary. First dot included in Pro (from $100/month) and Business Premium; Enterprise beta. Not in the EEA, Switzerland or UK.",
      "Propietario. El primer dot viene con Pro (desde USD 100 al mes) y Business Premium; beta en Enterprise. No disponible en el EEE, Suiza ni Reino Unido.",
    ),
  ],
  detail: text(
    "A dot is one personal agent inside ChatGPT: it works on OpenAI's cloud computer, shares your ChatGPT memory and plugins, and asks for approval according to rules you set. APX gives you several named agents organized by projects and a task board, running on your computer or a server you control, with the model providers and coding agents you choose. OpenAI says it plans to let you add more dots, so the difference today is less about having one agent and more about where the work runs and which ecosystem holds it.",
    "Un dot es un agente personal dentro de ChatGPT: trabaja en una computadora en la nube de OpenAI, comparte tu memoria y tus plugins de ChatGPT y pide aprobación según las reglas que definas. APX te da varios agentes con nombre, organizados por proyectos y un tablero de tareas, que corren en tu computadora o en un servidor que controlás, con los proveedores de modelos y agentes de código que elijas. OpenAI dice que planea permitir sumar más dots, así que la diferencia hoy pasa menos por tener un agente y más por dónde corre el trabajo y qué ecosistema lo contiene.",
  ),
  tryIt: text(
    "Ask each to check your calendar every morning and follow up on one open project for a week. Compare what it remembers, where its files end up and how you approve its actions.",
    "Pedile a cada uno que revise tu calendario cada mañana y siga un proyecto abierto durante una semana. Compará qué recuerda, dónde quedan sus archivos y cómo aprobás sus acciones.",
  ),
};
