export const DISCOVERY = {
  en: {
    eyebrow: "A few things worth knowing",
    title: "Questions before you start?",
    lead: "Get to know your crew, then make it your own.",
    read: "Read more",
    items: [
      {
        question: "What is APX?",
        answer:
          "APX is a team of AI agents organized around your projects. Give agents different roles, follow their work in a shared task board and keep conversations and project context together.",
        path: "/start/introduction/",
      },
      {
        question: "Where can I use it?",
        answer:
          "The desktop app runs on macOS, Windows and Linux. There is also an Android app, a web panel and a terminal client. You can run APX on your computer or on a server you control.",
        path: "/devices/desktop/",
      },
      {
        question: "Does everything stay on my computer?",
        answer:
          "APX keeps its state on your computer or server. The model providers and connected services you choose receive the information needed for their requests. APX also sends limited install events; optional usage statistics and ways to turn telemetry off are explained in the privacy guide.",
        path: "/reference/privacy/",
      },
      {
        question: "Is APX free?",
        answer:
          "APX is open source under the MIT license. Model providers, subscriptions and connected services may have separate costs; running a local model uses your own hardware.",
        path: "/concepts/models/",
      },
      {
        question: "Can I choose my models?",
        answer:
          "Yes. Connect supported model APIs or a local model through Ollama or LM Studio. Claude Code, Codex and other coding tools are also available as separate external sessions.",
        path: "/concepts/models/",
      },
      {
        question: "How much can agents do on their own?",
        answer:
          "You choose the permission mode. It determines which actions agents can take directly and which need your confirmation. Review the modes before giving agents more autonomy.",
        path: "/concepts/autonomy/",
      },
    ],
    compareEyebrow: "Find your fit",
    compareTitle: "How does APX compare?",
    compareLead: "Different tools, different ways to work. Explore the details and the sources behind each comparison.",
    compareAction: "Explore the comparison",
    all: "All comparisons",
    summaries: [
      "A project crew or a personal agent? Compare collaboration, memory and recurring work.",
      "Compare two approaches to a personal assistant: projects, devices and connected chats.",
      "Compare two approaches to agent teamwork, workspaces and licensing.",
    ],
  },
  es: {
    eyebrow: "Antes de empezar",
    title: "¿Tenés preguntas?",
    lead: "Conocé a tu equipo y hacelo tuyo.",
    read: "Leer más",
    items: [
      {
        question: "¿Qué es APX?",
        answer:
          "APX es un equipo de agentes de IA organizado alrededor de tus proyectos. Dales roles distintos, seguí su trabajo en un tablero compartido y mantené juntas las conversaciones y el contexto de cada proyecto.",
        path: "/start/introduction/",
      },
      {
        question: "¿Dónde lo puedo usar?",
        answer:
          "La app de escritorio funciona en macOS, Windows y Linux. También hay una app Android, un panel web y un cliente de terminal. Podés ejecutar APX en tu computadora o en un servidor que controles.",
        path: "/devices/desktop/",
      },
      {
        question: "¿Todo queda en mi computadora?",
        answer:
          "APX guarda su estado en tu computadora o servidor. Los proveedores de modelos y servicios que conectes reciben la información necesaria para sus pedidos. APX también envía eventos limitados de instalación; la guía de privacidad explica las estadísticas opcionales y cómo desactivar la telemetría.",
        path: "/reference/privacy/",
      },
      {
        question: "¿APX es gratis?",
        answer:
          "APX es de código abierto con licencia MIT. Los proveedores de modelos, suscripciones y servicios conectados pueden tener costos aparte; ejecutar un modelo local usa tu propio hardware.",
        path: "/concepts/models/",
      },
      {
        question: "¿Puedo elegir mis modelos?",
        answer:
          "Sí. Conectá proveedores de modelos compatibles o un modelo local con Ollama o LM Studio. Claude Code, Codex y otras herramientas de programación también están disponibles como sesiones externas separadas.",
        path: "/concepts/models/",
      },
      {
        question: "¿Cuánto pueden hacer los agentes por su cuenta?",
        answer:
          "Vos elegís el modo de permisos. Define qué acciones pueden hacer directamente y cuáles necesitan tu confirmación. Revisá los modos antes de darles más autonomía.",
        path: "/concepts/autonomy/",
      },
    ],
    compareEyebrow: "Elegí cómo trabajar",
    compareTitle: "¿Cómo se compara APX?",
    compareLead:
      "Herramientas distintas, formas distintas de trabajar. Explorá los detalles y las fuentes de cada comparación.",
    compareAction: "Explorá la comparativa",
    all: "Todas las comparativas",
    summaries: [
      "¿Un equipo por proyecto o un agente personal? Compará colaboración, memoria y trabajo recurrente.",
      "Compará dos enfoques de asistente personal: proyectos, dispositivos y chats conectados.",
      "Compará dos formas de organizar equipos de agentes, espacios de trabajo y licencias.",
    ],
  },
} as const;
