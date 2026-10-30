// Release news worth acting on: what a release lets the super-agent do for this owner. Each entry is told once, and
// only to an owner it applies to. See rules/DECISIONS.md#d-117
import type { Store } from "../domain/store.ts";
import { computerHost } from "../environments/host.ts";
import { CATALOG } from "../integrations/catalog.ts";
import { BROWSER_JAVASCRIPT_NEWS } from "./browser-javascript.ts";

/** What an entry may ask about this install before it is told. */
export type NewsFacts = {
  /** The owner's widgets and apps, in every project. */
  artifacts: number;
  /** Google's parts signed in to, and whether Gmail can be read (the owner's own client: APX's only sends). */
  google: { calendar: boolean; gmail: boolean; drive: boolean; gmailReadable: boolean };
  /** The super-agent runs the secretary profile (chief of staff). */
  secretary: boolean;
  /** People other than the owner write to them on a channel (contacts the agents answer). */
  contacts: boolean;
  /** Channels the owner connected (Telegram, WhatsApp…). */
  channels: number;
  /** An SMTP mailbox is configured as an Email channel. */
  email: boolean;
  /** Catalog integrations the owner connected (GitHub, Notion…). */
  integrations: number;
  /** This core can run the isolated Linux computer (macOS, Linux or Windows) and the owner has a project to try there. */
  computer: boolean;
  /** This core runs on a Mac and the owner has work there (a project). */
  mac: boolean;
  /** The owner has Codex sessions whose account limits the panel can query. */
  codex: boolean;
  claude?: boolean;
  /** At least one paired Desktop can use coordinated remote updates. */
  desktop?: boolean;
};

export type NewsAction = {
  /** The button, in the owner's language (English for any other). */
  label: { en: string; es: string };
  /** What pressing it says to the super-agent, as the owner's words. */
  prompt: string;
};

export type NewsEntry = {
  /** Stable and short: it travels in a channel button's id (64 bytes on Telegram). */
  id: string;
  /** The first release that has it. */
  since: string;
  /** A few words, in the owner's language (English for any other): the Help menu's line and the dialog's heading. */
  title: { en: string; es: string };
  /** One or two sentences for the owner, in their words: what they can do now. The dialog shows it. */
  about: { en: string; es: string };
  applies: (facts: NewsFacts) => boolean;
  /** What changed, for the super-agent to tell in its own words (English; the model writes the owner's language). */
  text: string;
  actions: NewsAction[];
};

export const NEWS: readonly NewsEntry[] = [
  BROWSER_JAVASCRIPT_NEWS,
  {
    id: "help-whats-new",
    since: "2.11.3",
    title: { en: "What's new, in the Help menu", es: "Las novedades, en el menú de ayuda" },
    about: {
      en: "The ? at the foot of the sidebar keeps what each release brought: open one to read it and ask your super-agent to set it up. The guides and the Discord are there too.",
      es: "El ? al pie de la barra lateral guarda lo que trajo cada versión: abrí una para leerla y pedirle a tu super-agente que te la configure. Ahí también están las guías y el Discord.",
    },
    applies: () => true,
    text:
      "The panel now has a Help menu (the ? at the foot of the sidebar) with what each release brought the owner: each " +
      "entry opens to what it lets them do, with a button that asks the super-agent for it, and every release can be " +
      "gone through again. It also links the guides, the Discord and feedback. From now on you tell only the one thing " +
      "that matters most and leave the rest there.",
    actions: [
      {
        label: { en: "What can you set up for me?", es: "¿Qué me podés configurar?" },
        prompt:
          "Look at what is new in APX for me and tell me, in two lines, the one thing worth setting up first. Change " +
          "nothing until I answer.",
      },
    ],
  },
  {
    id: "event-reminders",
    since: "2.11.2",
    title: { en: "Reminders before your events", es: "Recordatorios antes de tus eventos" },
    about: {
      en:
        "Google Calendar can message you shortly before each event, 30 minutes by default. Turn " +
        "it on in Resources › Integrations, on Google Calendar's page.",
      es:
        "Google Calendar puede avisarte poco antes de cada evento, 30 minutos por defecto. " +
        "Activalo en Recursos › Integraciones, en la página de Google Calendar.",
    },
    applies: (f) => f.google.calendar,
    text:
      "Google Calendar can now remind the owner of each event shortly before it starts (30 minutes by default): when, " +
      "how soon, what and where or the meeting link, in one line on their channel. All-day and declined events are left " +
      "out, and no model is called. It is off until turned on in Configure integration on Google Calendar's " +
      "page (Resources › Integrations), where the lead time is set too; quiet hours hold reminders like any the owner asked for.",
    actions: [
      {
        label: { en: "Turn on reminders", es: "Activar recordatorios" },
        prompt:
          "Turn on reminders for my Google Calendar events, then tell me in a line how long before they come and " +
          "where I can change it.",
      },
    ],
  },
  {
    id: "mail-check",
    since: "2.11.2",
    title: {
      en: "New mail is checked from Gmail's settings, as often as you choose",
      es: "La revisión del correo se configura en Gmail, con la frecuencia que elijas",
    },
    about: {
      en:
        "Choose how often APX looks at your new Gmail and whether only important mail counts. Do " +
        "it in Resources › Integrations, on Gmail's page.",
      es:
        "Elegí cada cuánto revisa APX tu correo nuevo de Gmail y si solo cuenta el importante. " +
        "Hacelo en Recursos › Integraciones, en la página de Gmail.",
    },
    applies: (f) => f.google.gmailReadable,
    text:
      "The Important mail routine is now Gmail's own mail check: it is turned on, timed (from every minute to once a " +
      "day) and narrowed to what Gmail marks important under Configure integration on Gmail's page (Resources › " +
      "Integrations). New mail outside ads, social and lists reaches the super-agent, who tells the owner what needs " +
      "them or stays quiet. An owner who had the routine on keeps it on, at the same pace. The same place can now bring " +
      "the signature the owner has in Gmail into APX.",
    actions: [
      {
        label: { en: "Set up the mail check", es: "Configurar la revisión de mails" },
        prompt:
          "Tell me whether my Gmail mail check is on and how often it looks, then ask me whether I want it on, how often, " +
          "and whether only important mail. Change nothing until I answer.",
      },
    ],
  },
  {
    id: "temporary-browser-consent",
    since: "2.11.2",
    title: {
      en: "Approve browser scripts for a tab or one turn",
      es: "Aprobá scripts del navegador para una pestaña o un turno",
    },
    about: {
      en:
        "When an agent asks to run a script, you can allow it once, for that tab, or for the " +
        "current turn. Permission ends when the tab changes or the turn finishes.",
      es:
        "Cuando un agente pide ejecutar un script, podés permitirlo una vez, para esa pestaña o " +
        "para el turno actual. El permiso termina al cambiar la pestaña o al acabar el turno.",
    },
    applies: () => true,
    text: "The browser JavaScript card offers Allow once, Allow in this tab and During this turn. Temporary consent allows new scripts without another card, but only for the same agent, chat and exact approved origin. Tab consent ends on navigation, reload, closure or browser reconnection; turn consent covers only the current run, including other tabs on the same origin. Tab consent expires within 30 minutes; turn consent lasts until the run ends, without an extra consent time limit. Both are lost on core restart and can be revoked. They never grant other tools, agents, chats or future routines. Scripts can read private data or send as the signed-in account; passwords, 2FA and card handling remain prohibited. An updated Desktop build is required for embedded tabs.",
    actions: [
      {
        label: { en: "Review temporary browser consent", es: "Revisar permisos temporales del navegador" },
        prompt:
          "Explain the temporary tab and current-turn choices on browser JavaScript approvals and how to revoke them. Do not execute JavaScript or change any permission yet.",
      },
    ],
  },
  {
    id: "secretary-capabilities",
    since: "2.11.2",
    title: { en: "Choose what your secretary watches for you", es: "Elegí qué vigila tu secretaria por vos" },
    about: {
      en:
        "In Settings › Super-agent you can turn Team news on or off and give it your own " +
        "instructions. Mail is checked from Gmail's settings.",
      es:
        "En Configuración › Super-agente podés activar o desactivar las noticias del equipo y darle tus " +
        "propias instrucciones. El correo se revisa desde los ajustes de Gmail.",
    },
    applies: (f) => f.secretary,
    text: "Settings → Super-agent has its own switch and custom instructions for Team news; it is no longer an action in New routine. Existing scheduled records, prompts and history are reused without replay. Profile changes do not reactivate a disabled capability. Changing the switch schedules the next check, not an immediate send. New mail is checked from Gmail's own settings.",
    actions: [
      {
        label: { en: "Review secretary capabilities", es: "Revisar capacidades de secretaría" },
        prompt: "Show me my team news settings and help me review them without enabling anything yet.",
      },
    ],
  },
  {
    id: "webhook-flows",
    since: "2.11.2",
    title: { en: "Run work only when a webhook arrives", es: "Ejecutá trabajo solo cuando llegue un webhook" },
    about: {
      en:
        "The new Flows entry in the sidebar lets you draw, on a canvas, what should happen when a " +
        "webhook arrives. Try it with sample data and see each run step by step.",
      es:
        "La nueva entrada Flows de la barra lateral te permite dibujar en un lienzo qué debe " +
        "pasar cuando llega un webhook. Probalo con datos de ejemplo y mirá cada ejecución paso " +
        "a paso.",
    },
    applies: (f) => f.secretary && f.channels > 0,
    text: "Flows now have their own global sidebar entry with a visual editor: the owner draws webhook, checks, a table and an agent or routine on a canvas, tries sample data without running anything, and sees each run step by step with its time and tokens. Flows accept authenticated webhook events, filter and write persistent project tables without a model, and optionally invoke a fixed agent or a manual-only routine when there is work. Idle, empty, filtered and duplicate events use no model calls. Each Flow has separate revocable route credentials in Settings, Devices. Events and run links survive restart. External sends are not exactly-once; review automation permissions before enabling effects.",
    actions: [
      {
        label: { en: "Prepare a Flow", es: "Preparar un Flow" },
        prompt:
          "Help me prepare a disabled project Flow, choose its filter and fixed action, and review public authentication before enabling it.",
      },
    ],
  },
  {
    id: "flow-graphs",
    since: "2.11.2",
    title: {
      en: "Flows run as drawn, with branches and model steps",
      es: "Los Flows se ejecutan como los dibujás, con ramas y pasos de modelo",
    },
    about: {
      en:
        "A Flow now runs exactly what you drew: yes and no branches, steps that join again and a " +
        "step that asks a model once. Each run shows every step.",
      es:
        "Un Flow ahora se ejecuta exactamente como lo dibujáste: ramas de sí y no, pasos que se " +
        "vuelven a unir y un paso que consulta un modelo una vez. Cada ejecución muestra todos " +
        "los pasos.",
    },
    applies: (f) => f.secretary && f.channels > 0,
    text: "A Flow now runs exactly the steps drawn in its editor: checks have yes and no branches, steps can join again, each step can receive what arrived or an earlier step's result, and a direct model step asks one set-up model once, without tools. Saving a drawing while the Flow is on (or turning it on) makes it what runs for new events; events already received finish with their version. Each run shows every step with its times, input, output and why it stopped. A model call is never sent twice: if its answer is lost the run is marked for the owner to look at. Each run has 10 minutes.",
    actions: [
      {
        label: { en: "Draw a branched Flow", es: "Dibujar un Flow con caminos" },
        prompt:
          "Help me plan a Flow with a yes/no check and the steps on each branch, then open it in the Flows editor, still off, for me to review.",
      },
    ],
  },
  {
    id: "flow-schedules",
    since: "2.11.2",
    title: {
      en: "Flows can run on a schedule, run now and be stopped",
      es: "Los Flows pueden ejecutarse con horario, ahora mismo y detenerse",
    },
    about: {
      en:
        "A Flow can start on a schedule, such as every hour or weekdays at 08:30. Use Run now on " +
        "its page to start it, and stop a run that is going.",
      es:
        "Un Flow puede empezar con un horario, por ejemplo cada hora o los días laborables a las " +
        "08:30. Usá Ejecutar ahora en su página para iniciarlo y detené una ejecución en curso.",
    },
    applies: (f) => f.secretary && f.channels > 0,
    text: "A Flow can now start on a schedule instead of a webhook: every 5 minutes, every hour, weekdays at 08:30, daily at 03:00 or any cron, in the owner's time zone, with the next runs shown in its editor and list. If APX was off at a run's time, the Flow runs once when APX starts, not once per missed time. Any published Flow has Run now on its page (a webhook Flow asks for a sample body, filled in with the last one it received), and a run that is going can be stopped: steps that haven't started don't run, and a model step already sent is left for the owner to look at, never sent again.",
    actions: [
      {
        label: { en: "Schedule a Flow", es: "Programar un Flow" },
        prompt:
          "Help me plan a Flow that runs on a schedule (when, in my time zone, and what each step does), then open it in the Flows editor, still off, for me to review.",
      },
    ],
  },
  {
    id: "flow-notify-http",
    since: "2.11.2",
    title: {
      en: "Flows can message you or a contact, and call other services",
      es: "Los Flows pueden escribirte, escribir a un contacto y llamar a otros servicios",
    },
    about: {
      en:
        "A Flow can end by sending a message on one of your chat apps, or call another service's " +
        "address using your saved Secrets. It asks you before doing something new.",
      es:
        "Un Flow puede terminar enviando un mensaje por una de tus apps de chat, o llamar a la " +
        "dirección de otro servicio con tus Secretos guardados. Te pregunta antes de hacer algo " +
        "nuevo.",
    },
    applies: (f) => f.secretary && f.channels > 0,
    text: "A Flow can now end in a message sent as the owner on one of their chat apps, to themselves, to someone they know there or to a room they listed, with values of the run in the words; it can skip the message when there is nothing to tell. It can also call another service's URL with GET, POST or PUT, keys taken from Secrets, and later steps read the answer. Before a Flow sends or calls somewhere new it asks the owner, and each message or change goes out once: one without an answer is left for the owner to look at, never repeated.",
    actions: [
      {
        label: { en: "Get told by a Flow", es: "Que un Flow me avise" },
        prompt:
          "Help me plan a Flow that tells me on my chat app when something I care about happens (what starts it, what it checks, what the message says), then open it in the Flows editor, still off, for me to review.",
      },
    ],
  },
  {
    id: "flow-steps",
    since: "2.11.2",
    title: {
      en: "Flows branch into cases, and run code, SQL and commands",
      es: "Los Flows se ramifican en casos y ejecutan código, SQL y comandos",
    },
    about: {
      en:
        "Flows now have checks with several cases, variables, JavaScript, SQL and shell command " +
        "steps. You approve a command or a database change before it runs.",
      es:
        "Los Flows ahora tienen comprobaciones con varios casos, variables y pasos de " +
        "JavaScript, SQL y comandos de shell. Aprobás un comando o un cambio en una base de " +
        "datos antes de que se ejecute.",
    },
    applies: (f) => f.secretary,
    text: "A Flow's check can now have several cases (a field is a value, or a formula holds) and goes on by the first that holds, else by otherwise. New blocks, none of which calls a model: Variables names values once for later steps; JavaScript runs a short function apart, with no files, internet or programs; SQL reads or writes a SQLite database in the project's folder with values always kept apart from the query; Cmd runs a shell command in the project's folder, values reaching it only as variables and input. Before a Flow runs a command or changes a database the owner allows it, and one that gets cut is left for the owner to look at, never run again.",
    actions: [
      {
        label: { en: "Sort things with a Flow", es: "Ordenar con un Flow" },
        prompt:
          "Help me plan a Flow that sorts what arrives into cases (what starts it, each case and what each way does, any database or command it uses), then open it in the Flows editor, still off, for me to review.",
      },
    ],
  },
  {
    id: "flow-tables",
    since: "2.11.2",
    title: {
      en: "Project tables: see them, fill them, and let Flows read them",
      es: "Tablas de proyecto: verlas, rellenarlas y dejar que los Flows las lean",
    },
    about: {
      en:
        "Each project has its own tables. See and edit them in Flows › Tables, and let a Flow " +
        "read or save rows with its Read and Save steps.",
      es:
        "Cada proyecto tiene sus propias tablas. Miralas y editalas en Flows › Tablas, y dejá " +
        "que un Flow lea o guarde filas con sus pasos Leer y Guardar.",
    },
    applies: (f) => f.secretary,
    text: "Each project now has tables of its own, a row per key and a value per column. The owner sees them on the Flows screen under Tables, where they add, change and delete rows and make tables and columns. A Flow's Read and Save steps pick any table of the project, or make a new table or column right there; a save fills it column by column and a read gives later steps each column. The super-agent can read a table or fill it without a Flow, like adding a lead to the leads table, and a Flow reads it later. A Flow variable can hold one of the owner's secrets, picked from the list: it is used only in a request's headers or a command's variables, never in a message or an instruction.",
    actions: [
      {
        label: { en: "Make a leads table", es: "Crear una tabla de leads" },
        prompt:
          "Make a leads table in the project I pick, with name, email and stage columns, and tell me how to fill it from a Flow or by asking you.",
      },
      {
        label: { en: "Keep leads in a table", es: "Guardar leads en una tabla" },
        prompt:
          "Help me plan a Flow that saves each incoming lead to a project table under its email and reads it back later, then open it in the Flows editor, still off, for me to review.",
      },
    ],
  },
  {
    id: "flow-agents",
    since: "2.11.2",
    title: { en: "Your super-agent draws Flows for you", es: "Tu super-agente dibuja Flows por vos" },
    about: {
      en:
        "Ask in any chat for a Flow and your assistant draws it for you. Open it in the editor to " +
        "review it, and turn it on when you are happy with it.",
      es:
        "Pedí un Flow en cualquier chat y tu asistente lo dibuja por vos. Abrilo en el editor " +
        "para revisarlo y activalo cuando estés conforme.",
    },
    applies: (f) => f.secretary,
    text: "The super-agent can now make a Flow in a project or change one's steps when the owner asks in any chat: it draws the steps, connects and places them, checks what keeps the drawing from running and fixes it. The chat shows the Flow's drawing with a button to open it in the editor. In the Flow editor itself, the Ask button opens a chat with the super-agent over the canvas: the owner says what to change and watches the steps appear as it draws them. What it saves is a draft: nothing runs until the owner reviews it in the editor and turns it on, and anything that sends as them, calls a service, runs a command or changes a database still asks them first.",
    actions: [
      {
        label: { en: "Draw a Flow with me", es: "Dibujar un Flow conmigo" },
        prompt:
          "Ask me what I want automated, then draw that Flow in the right project as a draft and show it to me here, still off, for me to review in the editor.",
      },
    ],
  },
  {
    id: "flow-ai-step",
    since: "2.11.2",
    title: {
      en: "A Flow's AI step: an agent or a bot of its own, on the model you pick",
      es: "El paso de IA de un Flow: un agente o un bot propio, con el modelo que elijas",
    },
    about: {
      en:
        "A Flow's AI step can use one of your agents or a bot made just for that Flow. Pick the " +
        "model and how freely it acts, and add values from earlier steps while you type.",
      es:
        "El paso de IA de un Flow puede usar uno de tus agentes o un bot hecho solo para ese " +
        "Flow. Elegí el modelo y cuánta libertad tiene, y agregá valores de pasos anteriores " +
        "mientras escribís.",
    },
    applies: (f) => f.secretary,
    text: "A Flow's AI model step can now be answered by an agent of the crew (with its instructions, memory and tools) or by a bot written just for that Flow: a name and how it works, starting from scratch each run. The owner picks the harness (APX, or Claude Code or Codex when they're installed), the model, the effort and how freely it acts. By default it works alone, without handing work to other agents; a switch on the step lets it. In every field that takes values, typing {{ or $ or pressing a button offers what arrived, earlier steps, variables and APX's values, shown as badges; secrets only where the step reads them itself, like a request's headers or a command's variables.",
    actions: [
      {
        label: { en: "Add a bot to a Flow", es: "Sumar un bot a un Flow" },
        prompt:
          "Help me plan a Flow with an AI model step answered by a bot of its own (its name, how it works, what it receives and what it hands on), then open it in the Flows editor, still off, for me to review.",
      },
    ],
  },
  {
    id: "flow-test-events",
    since: "2.11.2",
    title: {
      en: "Test a Flow with a real event before turning it on",
      es: "Probá un Flow con un evento real antes de activarlo",
    },
    about: {
      en:
        "In the Flow editor, Listen for a test event waits for one real event and runs your " +
        "drawing, even with the Flow off. A schedule Flow has Test now.",
      es:
        "En el editor del Flow, Escuchar un evento de prueba espera un evento real y ejecuta tu " +
        "dibujo, incluso con el Flow desactivado. Un Flow con horario tiene Probar ahora.",
    },
    applies: (f) => f.secretary,
    text: "A webhook Flow's address now shows in its editor from the start, with an end the owner names (from the Flow's name, changeable with a click), and a test address beside it. Listen for a test event in the editor's top bar waits five minutes for one event at the test address and runs the drawing as it is, for real, even with the Flow off: its steps light up as they run, and a log at the bottom shows what arrived and what each step got and gave. A schedule Flow has Test now. It asks first when the Flow would send, call, run or change something new. Test runs are listed with the Flow's runs, marked as tests.",
    actions: [
      {
        label: { en: "Test a Flow", es: "Probar un Flow" },
        prompt:
          "Tell me which of my Flows I could test with a real event now, and how to send one to its test address from the service that will call it.",
      },
    ],
  },
  {
    id: "restricted-public-ingress",
    since: "2.11.2",
    title: {
      en: "A public address without exposing the private app",
      es: "Una dirección pública sin exponer la app privada",
    },
    about: {
      en:
        "In Settings › Devices you can turn on a public web address for Flows, LINE, Teams and " +
        "widgets you choose to publish. Your panel and files stay private.",
      es:
        "En Configuración › Dispositivos podés activar una dirección web pública para Flows, LINE, " +
        "Teams y los widgets que decidas publicar. Tu panel y tus archivos siguen siendo " +
        "privados.",
    },
    applies: (f) => f.artifacts > 0 || f.channels > 0,
    text: "Settings › Devices now manages one restricted public HTTPS address for signed LINE/Teams webhooks, registered Flows with separate rotatable/revocable route tokens, and explicitly published read-only widgets. The panel, RPC, private widget state and files stay private. Turning on the tunnel does not publish private widgets. The public provider supplies the address; a fixed public IP is not promised. Publishing requires reviewing the HTML for private literals; public widgets cannot use private data or APX actions.",
    actions: [
      {
        label: { en: "Review public access", es: "Revisar acceso público" },
        prompt:
          "Help me review which APX resources should be public and open Settings › Devices without enabling a tunnel or publishing anything yet.",
      },
      {
        label: { en: "Prepare a read-only widget", es: "Preparar un widget de solo lectura" },
        prompt:
          "Help me prepare a read-only public widget, review its HTML for private content and explain its public-data limits before asking me to publish it.",
      },
    ],
  },
  {
    id: "email-preferences",
    since: "2.11.2",
    title: {
      en: "Keep connection settings separate from email preferences",
      es: "Separá los ajustes de conexión de las preferencias de correo",
    },
    about: {
      en:
        "Connection settings and email preferences are now apart. Add several mailboxes, each " +
        "with its own signature, and set a general signature in Settings › Account.",
      es:
        "Los ajustes de conexión y las preferencias de correo ahora están separados. Agregá varios " +
        "buzones, cada uno con su propia firma, y define una firma general en Configuración › Cuenta.",
    },
    applies: (f) => f.google.gmail || f.email,
    text: "Integrations now separate editing a connection from configuring preferences. Gmail's local email signature is in Configure integration. Email channels also allow adding and selecting multiple SMTP mailboxes, each with its own signature and existing channel preferences. Account settings hold an optional global text/HTML signature, editable before connecting an account. A specific account signature wins; an explicitly disabled account signature blocks the global fallback, and a message can omit either. Existing account signatures are preserved. No Gmail settings are changed or signatures imported.",
    actions: [
      {
        label: { en: "Review email preferences", es: "Revisar preferencias de email" },
        prompt:
          "Show me where to configure my email signature without reconnecting my account. Do not change anything yet.",
      },
    ],
  },
  {
    id: "device-text-size",
    since: "2.11.2",
    title: { en: "Choose a comfortable text size", es: "Elegí un tamaño de texto cómodo" },
    about: {
      en:
        "In Settings › Appearance you can pick 85%, 100%, 115% or 130% text size and see the " +
        "change right away. It is saved on this device.",
      es:
        "En Configuración › Apariencia podés elegir un tamaño de texto del 85 %, 100 %, 115 % o 130 % " +
        "y ver el cambio al instante. Se guarda en este dispositivo.",
    },
    applies: (f) => f.secretary,
    text: "Settings › Appearance now offers 85%, 100% (normal), 115% and 130% text sizes, with an immediate preview and a preference saved on this device. It changes interface and chat text without zooming images, embedded apps or the browser window. Embedded terminals keep their own text sizing.",
    actions: [
      {
        label: { en: "Find text size settings", es: "Ver dónde cambiar el tamaño del texto" },
        prompt:
          "Show me where to choose the text size in Settings › Appearance on this device. Do not change browser zoom or other preferences.",
      },
    ],
  },
  {
    id: "agents-finish-unattended",
    since: "2.11.2",
    title: { en: "Agents finish what you ask", es: "Los agentes terminan lo que les pides" },
    about: {
      en:
        "Agents keep going until they finish what you asked, with no turn or token limit by " +
        "default. You can set limits in Config › Agents › When agents work on their own.",
      es:
        "Los agentes siguen hasta terminar lo que les pediste, sin límite de turnos ni de tokens " +
        "por defecto. Podés fijar límites en Config › Agentes › Cuando los agentes trabajan " +
        "solos.",
    },
    applies: (f) => f.secretary,
    text: "Agents no longer pause after a number of turns or tokens without the owner: they finish what they were asked, like a coding agent. Limits are opt-in under Config › Agents › When agents work on their own (starting at 100 turns). The super-agent no longer stops on a system card to hand work to several agents: when asked for several things without saying how, it asks in its own words with options. It also tells the owner when its team closes a task and offers to adapt a project or agent the owner adds. Every notice reaches the app and paired phones; a chat app for notices is optional (Config › Super-agent › Where it writes to you, None keeps them in the app).",
    actions: [
      {
        label: { en: "Choose where you hear from me", es: "Elegir por dónde te aviso" },
        prompt:
          "Explain where you will tell me things now (the app, my phone, a chat app) and ask whether I want a chat app too or only the app. Do not change anything until I answer.",
      },
    ],
  },
  {
    id: "computer-linux-windows",
    since: "2.11.2",
    title: {
      en: "Your agents' computer, on Linux and Windows",
      es: "La computadora de tus agentes, en Linux y Windows",
    },
    about: {
      en:
        "Your agents can now use a separate Linux computer on this Linux or Windows machine too. " +
        "Allow it for an agent from its card, and watch their screens in Computers.",
      es:
        "Tus agentes ahora también pueden usar una computadora Linux aparte en este equipo Linux o " +
        "Windows. Permitilo para un agente desde su tarjeta y mirá sus pantallas en Computadoras.",
    },
    applies: (f) => f.computer && !f.mac,
    text:
      "Agents can now work on a Linux computer they share on this Linux or Windows machine too, not only on a Mac: a VM " +
      "apart from it with no way into it or the local network, where each allowed agent gets its own user, files and " +
      "screen with a desktop and browser. On Linux it needs QEMU and KVM; on Windows it runs on WSL 2 and needs Git for Windows. The first start " +
      "downloads and sets it up, and says what is missing if something is. It is off for every agent until the owner " +
      "allows one, in the agent's card or settings or by asking the super-agent; the Computers view then shows their screens.",
    actions: [
      {
        label: { en: "What could you do there?", es: "¿Qué harías ahí?" },
        prompt:
          "Tell me in a few lines what you could do for me on an isolated Linux computer that you cannot do here, " +
          "and how much memory it would take from this machine. Do not start it unless I say so.",
      },
      {
        label: { en: "Turn it on for an agent", es: "Activarla para un agente" },
        prompt:
          "Tell me which of my agents may use the isolated Linux computer now, and offer to turn it on for the one " +
          "I pick, with my OK on the card.",
      },
    ],
  },
  {
    id: "durable-task-attachments",
    since: "2.11.1",
    title: { en: "Keep screenshots and files with a task", es: "Guardá capturas y archivos con una tarea" },
    about: {
      en:
        "Attach screenshots and files to a task, when you create it or later. They stay with the " +
        "task, even if the chat is deleted, and you can preview and download them.",
      es:
        "Adjuntá capturas y archivos a una tarea, al crearla o después. Se quedan con la tarea " +
        "aunque se borre el chat, y podés previsualizarlos y descargarlos.",
    },
    applies: (f) => f.secretary,
    text: "Tasks can keep selected screenshots and files as durable snapshots, at creation or later. Authorized agents can inspect them from the task even after the source chat is deleted. The panel previews and downloads them. This does not grant access to private contact chats or publish files; sending outside APX remains a separate owner action.",
    actions: [
      {
        label: { en: "Attach files to a task", es: "Adjuntar archivos a una tarea" },
        prompt:
          "Help me choose a task and the screenshots or files to attach to it. Do not copy unrelated chat history or send anything outside APX.",
      },
    ],
  },
  {
    id: "task-chat-actions",
    since: "2.11.1",
    title: { en: "Manage tasks from their chat group", es: "Gestioná las tareas desde su grupo de chat" },
    about: {
      en:
        "Right-click a task's chat group, or use its actions button, to move the task, mark it " +
        "waiting, close or reopen it, or archive its chats. Its status shows beside the chat.",
      es:
        "Hacé clic derecho en el grupo de chat de una tarea, o usá su botón de acciones, para " +
        "moverla, marcarla en espera, cerrarla o reabrirla, o archivar sus chats. Su estado se ve " +
        "junto al chat.",
    },
    applies: (f) => f.secretary,
    text: "Task chat groups now offer a right-click menu and a visible actions button to change the task's column, mark it waiting, close or reopen it, and archive its chats. Archiving preserves history and does not close the task or restart work. Task status is also visible beside the chat header and updates live. A task's generic opening instruction shows its description as a read-only block with paragraphs, line breaks and lists.",
    actions: [
      {
        label: { en: "Review my tasks", es: "Revisar mis tareas" },
        prompt:
          "Show me my current tasks and explain how to change their state or archive their chats without losing history. Do not change anything yet.",
      },
    ],
  },
  {
    id: "coordinated-desktop-update",
    since: "2.11.1",
    title: {
      en: "Update the server before your Desktop apps",
      es: "Actualizá el servidor antes que tus apps de escritorio",
    },
    about: {
      en:
        "When your server runs on another computer, Desktop updates it first and then updates " +
        "itself, so both stay in step. Start it from the Desktop menu.",
      es:
        "Cuando tu servidor está en otro equipo, Desktop lo actualiza primero y luego se " +
        "actualiza a sí mismo, para que ambos vayan a la par. Inicialo desde el menú de Desktop.",
    },
    applies: (f) => Boolean(f.desktop),
    text:
      "Desktop now coordinates remote updates over the authenticated APX connection, without SSH. " +
      "A shared release is checked for server and client packages; the remote core updates once, and each app " +
      "can apply that release only after confirming the server is running it. Offline apps reconcile when they reconnect. " +
      "The local integrated core still updates with its Desktop bundle. Older or unsupported servers block the app update " +
      "with native recovery guidance; this is not an atomic update of every device.",
    actions: [
      {
        label: { en: "Review my update setup", es: "Revisar mis actualizaciones" },
        prompt:
          "Help me check how my APX core is installed and explain the coordinated update flow before I update from the Desktop menu.",
      },
    ],
  },
  {
    id: "email-signature-settings",
    since: "2.11.1",
    title: {
      en: "Let your agent configure your email signature",
      es: "Dejá que tu agente configure tu firma de correo",
    },
    about: {
      en:
        "Ask your assistant to read or change the signature of any of your mailboxes. It shows " +
        "you the change and waits for your approval first.",
      es:
        "Pedile a tu asistente que lea o cambie la firma de cualquiera de tus buzones. Te muestra " +
        "el cambio y espera tu aprobación antes de aplicarlo.",
    },
    applies: (f) => f.google.gmail || f.email,
    text:
      "The super-agent can now read and change individual local APX email signatures with your approval. " +
      "Each signature must match a configured Gmail account or SMTP mailbox. Other signatures are preserved, " +
      "and a concurrent edit requires a fresh read. This does not import or change Gmail settings or send mail.",
    actions: [
      {
        label: { en: "Configure my signature", es: "Configurar mi firma" },
        prompt:
          "Help me configure my local APX email signature. Read my configured mailboxes and ask which signature to use before changing anything.",
      },
    ],
  },
  {
    id: "email-signatures",
    since: "2.11.1",
    title: { en: "Email signatures by sender", es: "Firmas de correo por remitente" },
    about: {
      en:
        "In Settings › Account, give each Gmail or email account its own signature, as plain text " +
        "or simple HTML. New messages and replies include it automatically.",
      es:
        "En Configuración › Cuenta, dale a cada cuenta de Gmail o de correo su propia firma, en texto " +
        "plano o HTML sencillo. Los mensajes nuevos y las respuestas la incluyen automáticamente.",
    },
    applies: (f) => f.google.gmail || f.email,
    text:
      "Settings, Account now lets the owner configure a plain-text and optional basic HTML signature for each " +
      "connected Gmail sender or SMTP Email channel. New messages and replies include it automatically; ask to omit " +
      "it for one message. Links and hosted HTTPS images are supported. Existing Gmail drafts are sent unchanged. " +
      "Gmail signatures are not imported because the connection does not request Gmail settings access; copying one " +
      "into APX changes only APX's local signature, not Gmail settings.",
    actions: [
      {
        label: { en: "Where do I set my signature?", es: "¿Dónde configuro mi firma?" },
        prompt:
          "Show me where to configure email signatures in Settings, Account and explain which email account each signature applies to.",
      },
    ],
  },
  {
    id: "engine-usage",
    since: "2.11.1",
    title: { en: "Account limits in the top bar", es: "Límites de tu cuenta en la barra superior" },
    about: {
      en:
        "The AI usage button in the top bar shows how much of your Codex and Claude plans is left " +
        "and when it resets. Turn Usage on for each engine in its card.",
      es:
        "El botón de uso de IA de la barra superior muestra cuánto te queda de tus planes de " +
        "Codex y Claude y cuándo se renuevan. Activá Uso en la tarjeta de cada motor.",
    },
    applies: (f) => f.codex || f.claude === true,
    text:
      "The panel's AI usage button shows Codex and Claude account quota windows, the share remaining and reset times " +
      "when their local CLIs can report them. Claude Code 2.1.273 or later supplies structured /usage reports. " +
      "These are account limits, not token totals from APX chats. OpenCode and Antigravity have explicit " +
      "unavailable states and guidance rather than estimated subscription balances. " +
      "The check runs on the core's computer, without starting a model turn or reading credentials in APX. " +
      "Each engine card has a compact Usage switch independent of model power. Quota checks default off except " +
      "for a linked ChatGPT plan; an explicit choice is remembered. Codex quota metadata still requires its " +
      "separately linked local CLI account. Turning Usage off also stops its account probes.",
    actions: [
      {
        label: { en: "Where are my limits?", es: "¿Dónde veo mis límites?" },
        prompt:
          "Explain where the AI usage button is in the panel and how account limits differ from the tokens shown in my chats.",
      },
    ],
  },
  {
    id: "artifacts-kit",
    since: "2.8.0",
    title: { en: "Widgets remember and can become apps", es: "Los widgets recuerdan y pueden convertirse en apps" },
    about: {
      en:
        "Your widgets open with their last data already showing, can stay live in the background " +
        "and have a new look. A widget can also grow into an app with its own records.",
      es:
        "Tus widgets se abren con sus últimos datos ya a la vista, pueden mantenerse en vivo en " +
        "segundo plano y tienen un nuevo aspecto. Un widget también puede convertirse en una app " +
        "con sus propios registros.",
    },
    applies: (f) => f.artifacts > 0,
    text:
      "Widgets now remember their last reading, so they open with data at once; they can stay live while hidden; " +
      "they have a new look (aurora); and one can become an app with its own records.",
    actions: [
      {
        label: { en: "Update my widgets", es: "Actualizar mis widgets" },
        prompt:
          "Review my widgets and offer to update them to the new APX Kit design and memory (the last reading kept, " +
          "live where it helps). Tell me which ones you would change and how before changing them; hand the work to " +
          "my agents if you prefer.",
      },
      {
        label: { en: "Make one an app", es: "Convertir uno en app" },
        prompt:
          "Look at my widgets and suggest which one would work better as an app (keeping records, its own screens). " +
          "Say why, and wait for my yes before building it.",
      },
    ],
  },
  {
    id: "google",
    since: "2.9.0",
    title: { en: "Google Calendar, Gmail and Drive", es: "Google Calendar, Gmail y Drive" },
    about: {
      en:
        "Connect Google in Resources › Integrations and your assistant can set up meetings with a " +
        "Meet link, find free time, read and send mail and work with your Drive documents.",
      es:
        "Conectá Google en Recursos › Integraciones y tu asistente podrá crear reuniones con " +
        "enlace de Meet, buscar huecos libres, leer y enviar correos y trabajar con tus " +
        "documentos de Drive.",
    },
    applies: (f) => !f.google.calendar,
    text:
      "The super-agent can now use the owner's Google account: create meetings with a Google Meet link and invite " +
      "people, move or cancel them and add guests later, find free time; read and send mail; find, read and write " +
      "Docs in Drive. Calendar connects with one click and no Google Cloud setup; reading all of Gmail and Drive uses " +
      "the owner's own OAuth client, which the dialog walks them through once.",
    actions: [
      {
        label: { en: "Connect Calendar", es: "Conectar Calendar" },
        prompt:
          "Help me connect Google Calendar: link me to Resources › Integrations, say in a line what it lets you do " +
          "for me, and once it is connected tell me what I have this week.",
      },
      {
        label: { en: "What can you do?", es: "¿Qué podés hacer?" },
        prompt:
          "Tell me in a few lines what you can do with my Google Calendar, Gmail and Drive once they are connected, " +
          "and which one I should connect first for how I work.",
      },
    ],
  },
  {
    id: "mail-alerts",
    since: "2.9.0",
    title: { en: "Important mail, as it lands", es: "Correo importante, en cuanto llega" },
    about: {
      en:
        "Your assistant checks new mail every few minutes and tells you only what needs you soon. " +
        "Ads and social mail never reach you; thumbs up or down teach it.",
      es:
        "Tu asistente revisa el correo nuevo cada pocos minutos y te avisa solo de lo que te " +
        "necesita pronto. La publicidad y el correo social no te llegan; tus 👍 y 👎 le enseñan.",
    },
    applies: (f) => f.secretary && f.google.gmailReadable,
    text:
      "As chief of staff, the super-agent now reads new mail every few minutes and tells the owner only what needs " +
      "them soon; ads and social mail never reach it, and nothing new costs nothing. The owner's 👍 or 👎 on those " +
      "messages teach it. Its morning brief also reads today's events from Google Calendar.",
    actions: [
      {
        label: { en: "How do you choose?", es: "¿Cómo elegís?" },
        prompt:
          "Explain in a few lines how you decide which new mail to tell me about, then ask me which senders or " +
          "subjects always matter to me and which never do, and remember what I say.",
      },
      {
        label: { en: "Check less often", es: "Revisar menos seguido" },
        prompt:
          "Tell me how often you check my mail now (Settings › Profile › Check mail every) and change it to every " +
          "15 minutes if I say yes.",
      },
    ],
  },
  {
    id: "channel-hours",
    since: "2.10.0",
    title: { en: "Attention hours for contacts", es: "Horario de atención para contactos" },
    about: {
      en:
        "Set attention hours on each channel, or on a contact's card. Outside them contacts get " +
        "no answer, and everything is answered once when the hours begin.",
      es:
        "Definí un horario de atención en cada canal, o en la ficha de un contacto. Fuera de él " +
        "los contactos no reciben respuesta, y todo se contesta una vez cuando empieza el " +
        "horario.",
    },
    applies: (f) => f.contacts,
    text:
      "A channel can now keep attention hours (days, from, to, in the owner's time zone): a contact who writes " +
      "outside them gets no answer then, and the agent answers everything they sent, once, when the hours begin. " +
      "The owner is always answered, and a contact can be marked to be answered at any hour. The owner sets them in " +
      "each channel's settings and on the contact's card, or asks the super-agent, who sets both with " +
      "apx_settings once the owner approves each change.",
    actions: [
      {
        label: { en: "Suggest my hours", es: "Sugerime un horario" },
        prompt:
          "Look at when my contacts usually write to me and suggest attention hours for my channels, and which " +
          "contacts you would answer at any hour. If I agree, set them.",
      },
    ],
  },
  {
    id: "super-agent-settings",
    since: "2.10.0",
    title: { en: "Settings changed from chat", es: "Configuración cambiada desde el chat" },
    about: {
      en:
        "Ask in chat to change almost anything you set up in the panel, such as a contact, a " +
        "channel, your profile, projects or routines. You see the change and approve it first.",
      es:
        "Pedí por chat que se cambie casi cualquier cosa que configurás en el panel, como un " +
        "contacto, un canal, tu perfil, proyectos o rutinas. Ves el cambio y lo aprobás antes.",
    },
    // The owner's profile, notices, projects and memory are every owner's: contacts are only part of it.
    applies: () => true,
    text:
      "The super-agent can now change, with apx_settings, almost anything the owner sets up in the panel: a " +
      "contact (who they are, the rules to answer them, their relation), a channel (who answers it, strangers, " +
      "rooms), the owner's own profile and time zone, when they are notified, projects, memory, skills, agent " +
      "profiles, routines, archived agents, tasks, chats, widgets and MCP servers (their keys named by a variable the " +
      "owner saved, never typed in chat). Each change shows the owner the fields before and after, and waits for " +
      "their yes. Saving a key, sign-ins, models, what agents may do and this computer stay the owner's, in Settings.",
    actions: [
      {
        label: { en: "What can you change?", es: "¿Qué podés cambiar?" },
        prompt:
          "Tell me in a few lines what you can change in my APX settings from chat, then ask me what I would like " +
          "to adjust, and change it as I tell you.",
      },
      {
        label: { en: "Set my quiet hours", es: "Configurá mis horas de silencio" },
        prompt: "Ask me when I do not want to be notified and how many notices a day are fine, then set it up.",
      },
    ],
  },
  {
    id: "stickers",
    since: "2.10.0",
    title: { en: "Stickers kept and sent back", es: "Stickers guardados y devueltos" },
    about: {
      en:
        "Stickers people send you on WhatsApp or Telegram are kept, and your agent can answer " +
        "with one. Manage them in each channel's settings, under Stickers.",
      es:
        "Los stickers que te envían por WhatsApp o Telegram se guardan, y tu agente puede " +
        "responder con uno. Gestionalos en los ajustes de cada canal, en Stickers.",
    },
    applies: (f) => f.contacts,
    text:
      "Every sticker someone sends on WhatsApp or Telegram is now kept the moment it arrives, named once by what it " +
      "shows, so the agent understands it and can answer a chat with one of them instead of words, on the same " +
      "platform. They are listed in each channel's settings, under Stickers, where the owner can say what one " +
      "means or that the agent may not use it, and choose whether new ones are the agent's to use at once (the " +
      "default) or wait for their OK; one for adults always waits. Reactions the agent puts now show in the app too.",
    actions: [
      {
        label: { en: "Answer me with a sticker", es: "Contestame con un sticker" },
        prompt:
          "Answer this message with one of the stickers people sent me on this channel, the one that fits best. If " +
          "none is kept here yet, tell me in words that a sticker sent to you is kept and you can use it after.",
      },
    ],
  },
  {
    id: "more-apps",
    since: "2.10.0",
    title: { en: "Fifty more integrations", es: "Cincuenta integraciones más" },
    about: {
      en:
        "Resources › Integrations now connects about fifty more apps, such as Linear, Jira, " +
        "Stripe and Figma. Most take one click and a browser sign-in; use the search box to find " +
        "them.",
      es:
        "Recursos › Integraciones ahora conecta unas cincuenta apps más, como Linear, Jira, " +
        "Stripe y Figma. La mayoría solo requiere un clic e iniciar sesión en el navegador; usá " +
        "el buscador para encontrarlas.",
    },
    applies: (f) => f.integrations > 0,
    text:
      "Resources › Integrations now connects about fifty more apps, most with one click and a sign-in in the " +
      "browser, nothing to paste: Linear, Jira and Confluence, GitLab, Vercel, Supabase, Stripe, Todoist, Airtable, " +
      "Figma, Canva, Cloudflare, Dropbox, Calendly, PayPal and more; Home Assistant and n8n take their address and a " +
      "token. The catalog has a search box. GitHub, Slack and Brave Search now run on their maintained servers: " +
      "editing and saving one switches it.",
    actions: [
      {
        label: { en: "Which ones help me?", es: "¿Cuáles me sirven?" },
        prompt:
          "Look at what I work on and the integrations I already have, and suggest the two or three new ones from " +
          "Resources › Integrations that would help me most, saying in a line what you would do with each.",
      },
    ],
  },
  {
    id: "more-channels",
    since: "2.10.0",
    title: { en: "New channels", es: "Nuevos canales" },
    about: {
      en:
        "Your agents can now be reached on iMessage, Google Chat, SMS, ntfy, Nextcloud Talk, IRC " +
        "and Twitch. Set each one up in Settings › Channels.",
      es:
        "Ahora podés hablar con tus agentes por iMessage, Google Chat, SMS, ntfy, Nextcloud " +
        "Talk, IRC y Twitch. Configurá cada uno en Configuración › Canales.",
    },
    applies: (f) => f.channels > 0,
    text:
      "Agents can now be reached on more apps: iMessage on the owner's Mac, Google Chat, SMS through Twilio, ntfy " +
      "push notifications, Nextcloud Talk, IRC and Twitch chat. Each is set up in Settings › Channels, like the others.",
    actions: [
      {
        label: { en: "Set one up", es: "Configurar uno" },
        prompt:
          "Tell me in a few lines which of the new channels (iMessage, Google Chat, SMS, ntfy, Nextcloud Talk, IRC, " +
          "Twitch) would suit how I use you, and walk me through setting up the one I pick.",
      },
    ],
  },
  {
    id: "teams-line",
    since: "2.10.0",
    title: { en: "Microsoft Teams and LINE", es: "Microsoft Teams y LINE" },
    about: {
      en:
        "Connect Microsoft Teams and LINE in Settings › Channels. Their screen first helps you " +
        "turn on a public address so the apps can reach you.",
      es:
        "Conectá Microsoft Teams y LINE en Configuración › Canales. Su pantalla te ayuda primero a " +
        "activar una dirección pública para que las apps puedan llegar hasta vos.",
    },
    applies: (f) => f.channels > 0,
    text:
      "Agents can now be reached on Microsoft Teams and LINE. Both send their messages to a web address, so their " +
      "screen in Settings › Channels turns on a public address first: Tailscale Funnel (a fixed address), ngrok " +
      "(started by APX, which says when its address is new) or the " +
      "owner's own. Only a door for webhooks is published, never the panel, and every message is checked.",
    actions: [
      {
        label: { en: "Set up Teams", es: "Configurar Teams" },
        prompt:
          "Walk me through connecting Microsoft Teams: what to create in Azure, how to turn on the public address " +
          "(Tailscale or ngrok, whichever I have), and where to paste each value.",
      },
    ],
  },
  {
    id: "owner-check",
    since: "2.10.0",
    title: { en: "Channel messages checked first", es: "Mensajes de canales revisados primero" },
    about: {
      en:
        "On most chat apps, a message that says it is from you is checked first. Your assistant " +
        "may ask you in the app before anything happens.",
      es:
        "En la mayoría de las apps de chat, un mensaje que dice ser tuyo se revisa primero. Tu " +
        "asistente puede preguntarte en la app antes de que ocurra algo.",
    },
    applies: (f) => f.channels > 0,
    text:
      "On every channel but Telegram, WhatsApp and Signal, a message that comes as the owner no longer acts by " +
      "itself: those apps cannot always prove who wrote. The super-agent reads it first, asks the owner in the app " +
      "when it is unsure or the request is risky, and then the channel's agent does what was decided and answers " +
      "there. Confirmations and questions are answered in the app (the panel, the desktop or the paired phone); on " +
      "Telegram, WhatsApp and Signal they still can be, except a change to the owner's settings, which is approved " +
      "only in the app.",
    actions: [
      {
        label: { en: "How it works for me", es: "Cómo me queda a mí" },
        prompt:
          "Tell me in a few lines which of my channels act on my word directly and which go through you first, and " +
          "where I approve things now.",
      },
    ],
  },
  {
    id: "linux-computer",
    since: "2.11.0",
    title: { en: "A Linux computer your agents share", es: "Una computadora Linux que comparten tus agentes" },
    about: {
      en:
        "Your agents can use a separate Linux computer, each with its own screen, desktop and " +
        "browser. Allow it per agent, and see every screen in Computers.",
      es:
        "Tus agentes pueden usar una computadora Linux aparte, cada uno con su propia pantalla, " +
        "escritorio y navegador. Permitilo por agente y mirá todas las pantallas en Computadoras.",
    },
    applies: (f) => f.computer && f.mac,
    text:
      "Agents can now work on a Linux computer they share, a VM apart from the owner's Mac with no way into the Mac " +
      "or the local network. Each agent gets its own user, files and screen with a desktop and browser. It is off " +
      "for every agent until the owner allows one: in the agent's card or settings, from the card the agent shows " +
      "when it asks, or by asking the super-agent. An allowed agent starts it itself; it does not start without enough free memory, and APX shuts it down " +
      "when the Mac runs short or nobody uses it, keeping its files. The new Computers view shows every allowed agent's " +
      "screen at once, and the owner can turn any of them on or off from there; memory, CPUs and disk are set in the Computer panel.",
    actions: [
      {
        label: { en: "What could you do there?", es: "¿Qué harías ahí?" },
        prompt:
          "Tell me in a few lines what you could do for me on an isolated Linux computer that you cannot do here, " +
          "and how much memory it would take from this Mac. Do not start it unless I say so.",
      },
      {
        label: { en: "Turn it on for an agent", es: "Activarla para un agente" },
        prompt:
          "Tell me which of my agents may use the isolated Linux computer now, and offer to turn it on for the one " +
          "I pick, with my OK on the card.",
      },
    ],
  },
  {
    id: "mac-awake",
    since: "2.11.0",
    title: { en: "The Mac stays awake while agents work", es: "El Mac sigue despierto mientras trabajan los agentes" },
    about: {
      en:
        "Your Mac no longer goes to sleep while an agent is working. You can turn this off in " + "Settings › Desktop.",
      es: "Tu Mac ya no se duerme mientras un agente trabaja. Podés desactivarlo en Configuración › " + "Escritorio.",
    },
    applies: (f) => f.mac,
    text:
      "While an agent works on a turn, a command runs or the Linux computer starts, the owner's Mac no longer goes " +
      "to sleep on its own; it may sleep again as soon as nothing runs, and the screen can still turn off. If the " +
      "Mac sleeps anyway (the lid closed), work it interrupted gets another chance instead of being marked stuck. " +
      "The owner turns it off in Settings, Desktop.",
    actions: [
      {
        label: { en: "When does it apply?", es: "¿Cuándo se aplica?" },
        prompt: "Tell me in two lines when APX keeps my Mac awake now and how I turn that off if I prefer it to sleep.",
      },
    ],
  },
];

/** The catalog integrations among the owner's global MCP servers. */
const connectedIntegrations = (store: Store): number => {
  try {
    const servers = JSON.parse(store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: object };
    const names = Object.keys(servers.mcpServers ?? {});
    return CATALOG.filter((e) => names.includes(e.id)).length;
  } catch {
    return 0;
  }
};

const signedIn = (store: Store, id: string) => Boolean(store.settings.get(`google_account:${id}`));

export const newsFacts = (store: Store): NewsFacts => ({
  artifacts: store.surfaces.list().length,
  desktop: store.devices.list().some((d) => d.platform === "desktop"),
  codex: store.threads.list({ engine: "codex", limit: 1 }).length > 0,
  claude: store.threads.list({ engine: "claude", limit: 1 }).length > 0,
  google: {
    calendar: signedIn(store, "google-calendar"),
    gmail: signedIn(store, "gmail"),
    drive: signedIn(store, "google-drive"),
    gmailReadable: signedIn(store, "gmail") && store.settings.get("google_client:gmail") === "own",
  },
  secretary: store.settings.read("profile").id === "secretary",
  contacts: store.persons.list().some((p) => p.role !== "owner" && p.role !== "blocked" && p.addresses.length > 0),
  channels: store.settings.read("channels").length,
  email: store.settings.read("channels").some((c) => c.type === "email" && c.email !== undefined),
  integrations: connectedIntegrations(store),
  computer: computerHost() !== undefined && store.projects.list().length > 0,
  mac: process.platform === "darwin" && store.projects.list().length > 0,
});

/** The action a channel button stands for. */
export const newsAction = (entryId: string, index: number): NewsAction | undefined =>
  NEWS.find((e) => e.id === entryId)?.actions[index];
