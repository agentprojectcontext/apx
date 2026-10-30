import { type Product, text } from "./shared.ts";

const hermesReadme =
  "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/README.md";

export const hermesAgent: Product = {
  slug: "hermes-agent",
  name: "Hermes Agent",
  logo: "hermes.png",
  source: "https://github.com/NousResearch/hermes-agent",
  detailSource: hermesReadme,
  sources: [
    { title: "Hermes Agent on GitHub", url: "https://github.com/NousResearch/hermes-agent" },
    { title: "Hermes Agent README", url: hermesReadme },
    {
      title: "Hermes Agent license",
      url: "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
    },
  ],
  license: "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
  rowSources: [
    [hermesReadme],
    [hermesReadme],
    [hermesReadme],
    [hermesReadme],
    [hermesReadme],
    [hermesReadme],
    [hermesReadme],
    [
      "https://github.com/NousResearch/hermes-agent/blob/5057eaa3a4d0cbef0e30078418a5115faa62889e/LICENSE",
      hermesReadme,
    ],
  ],
  short: text("self-improving assistant", "asistente que aprende"),
  tagline: text("A project crew or a self-improving assistant?", "¿Un equipo por proyecto o un asistente que aprende?"),
  intro: text(
    "Both support memory, skills, delegation and scheduled work. The useful distinction is how you want to organize your day: a visible project crew in APX, or Hermes’ assistant and skill-learning workflow.",
    "Ambos ofrecen memoria, habilidades, delegación y trabajo programado. La diferencia útil está en cómo querés organizar tu día: un equipo visible por proyecto en APX, o el flujo de asistente y aprendizaje de habilidades de Hermes.",
  ),
  choice: text(
    "You want an assistant built around creating and improving skills from experience, with a terminal, desktop app and messaging gateway.",
    "Querés un asistente centrado en crear y mejorar habilidades a partir de la experiencia, con terminal, app de escritorio y conexión a mensajería.",
  ),
  rows: [
    text(
      "A self-improving assistant with a built-in skill-learning loop.",
      "Un asistente que aprende con un ciclo integrado de mejora de habilidades.",
    ),
    text(
      "Terminal UI, desktop app and messaging gateway.",
      "Interfaz de terminal, app de escritorio y conexión a mensajería.",
    ),
    text(
      "The agent runs on your computer or a server. Commands can run locally, in Docker, over SSH or in sandboxes such as Modal and Daytona.",
      "El agente corre en tu computadora o un servidor. Los comandos pueden ejecutarse localmente, en Docker, por SSH o en entornos como Modal y Daytona.",
    ),
    text(
      "Can spawn isolated subagents for parallel work.",
      "Puede crear subagentes aislados para trabajar en paralelo.",
    ),
    text(
      "Curated memory, past-conversation search and skills improved during use.",
      "Memoria curada, búsqueda en conversaciones anteriores y habilidades que mejoran con el uso.",
    ),
    text(
      "Built-in cron with platform delivery; Telegram, Discord, Slack and more.",
      "Cron integrado con entrega a plataformas; Telegram, Discord, Slack y más.",
    ),
    text(
      "Multiple model providers, MCP, skills and plugins.",
      "Varios proveedores de modelos, MCP, habilidades y plugins.",
    ),
    text(
      "MIT. Providers and hosted execution can cost extra.",
      "MIT. Los proveedores y la ejecución alojada pueden tener costos aparte.",
    ),
  ],
  detail: text(
    "Hermes explicitly documents skill creation and refinement as part of its learning loop. APX puts projects, named agents and task follow-through at the center. Hermes also delegates work: choosing APX is not a choice between having a team and having no delegation.",
    "Hermes documenta explícitamente la creación y mejora de habilidades como parte de su aprendizaje. APX pone en el centro los proyectos, los agentes con identidad y el seguimiento de tareas. Hermes también delega: elegir APX no es elegir entre tener equipo o no tener delegación.",
  ),
  tryIt: text(
    "Give each product a recurring research task and a follow-up a week later. Check what it remembers, how you correct it and how easily you find the result.",
    "Dale a cada producto una investigación recurrente y retomá el tema una semana después. Revisá qué recuerda, cómo lo corregís y qué tan fácil encontrás el resultado.",
  ),
};
