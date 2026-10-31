import { type Product, text } from "./shared.ts";

export const instinct: Product = {
  slug: "instinct",
  name: "Instinct",
  logo: "instinct.png",
  source: "https://instinct.com/",
  detailSource: "https://instinct.com/terms",
  license: "https://instinct.com/terms",
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
  rowSources: [
    ["https://instinct.com/", "https://instinct.com/terms"],
    ["https://instinct.com/", "https://instinct.com/terms"],
    ["https://instinct.com/terms", "https://instinct.com/privacy-policy"],
    ["https://instinct.com/", "https://instinct.com/terms"],
    ["https://instinct.com/", "https://instinct.com/terms"],
    ["https://instinct.com/", "https://instinct.com/terms"],
    ["https://instinct.com/terms", "https://instinct.com/privacy-policy"],
    ["https://instinct.com/terms"],
  ],
  short: text("assistant you text", "asistente por mensaje"),
  tagline: text(
    "A project crew or an assistant you text?",
    "¿Un equipo por proyecto o un asistente al que le escribís?",
  ),
  intro: text(
    "Instinct is a personal assistant you text or call to handle everyday tasks, such as groceries, bookings or gifts. APX organizes a team of agents around your projects; Instinct acts for you across your accounts as a hosted service.",
    "Instinct es un asistente personal al que le escribís o llamás para resolver tareas cotidianas, como compras, reservas o regalos. APX organiza un equipo de agentes alrededor de tus proyectos; Instinct actúa por vos en tus cuentas como un servicio alojado.",
  ),
  choice: text(
    "You want one assistant for personal errands that you reach by text or phone call, with no new interface to learn.",
    "Querés un solo asistente para trámites personales, al que le escribís o llamás, sin aprender una interfaz nueva.",
  ),
  rows: [
    text(
      "A personal assistant that takes actions for you on everyday tasks.",
      "Un asistente personal que hace cosas por vos en tareas cotidianas.",
    ),
    text(
      "Text or call it; there is also a web app and a Mac app.",
      "Le escribís o lo llamás; también hay app web y app para Mac.",
    ),
    text(
      "A hosted service operated in the United States; it indexes data from the accounts you connect.",
      "Un servicio alojado operado en Estados Unidos; indexa datos de las cuentas que conectás.",
    ),
    text(
      "Its public pages describe one assistant; team or multi-agent features are not documented.",
      "Sus páginas públicas describen un solo asistente; no documentan funciones de equipo ni varios agentes.",
    ),
    text(
      "Learns what you are working on; indexed account data and a Vault for your materials.",
      "Aprende en qué estás trabajando; datos indexados de tus cuentas y un Vault para tus materiales.",
    ),
    text(
      "Reached by text message and phone call; scheduled work is not documented.",
      "Se usa por mensaje de texto y llamada; no documenta trabajo programado.",
    ),
    text(
      "Third-party language models, not named; connects Apple, Facebook and Google accounts, including Google Workspace.",
      "Modelos de lenguaje de terceros, sin nombrarlos; conecta cuentas de Apple, Facebook y Google, incluido Google Workspace.",
    ),
    text(
      "Proprietary. Some features are paid in US dollars; no public price list.",
      "Propietario. Algunas funciones son pagas en dólares; no publica lista de precios.",
    ),
  ],
  detail: text(
    "Instinct is built for personal errands: you message it, and it acts through the accounts you connect, including purchases and accepting terms on your behalf. Its terms say those actions may not always be reversible and ask you to monitor them and set safeguards. APX is organized around projects, named agents and tracked tasks that run on a computer or server you control.",
    "Instinct está pensado para trámites personales: le escribís y actúa a través de las cuentas que conectás, incluso comprando o aceptando términos en tu nombre. Sus términos dicen que esas acciones no siempre se pueden deshacer y te piden supervisarlas y configurar resguardos. APX se organiza alrededor de proyectos, agentes con nombre y tareas con seguimiento, en una computadora o servidor que controlás.",
  ),
  tryIt: text(
    "Ask each one to plan and book a small errand, like a table for two. Check what it asks before acting, what it can undo and where you see what it did.",
    "Pedile a cada uno que organice y reserve un trámite chico, como una mesa para dos. Fijate qué te pregunta antes de actuar, qué puede deshacer y dónde ves lo que hizo.",
  ),
};
