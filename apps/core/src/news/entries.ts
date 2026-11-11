// Release news worth acting on: what a release lets the super-agent do for this owner. Each entry is told once, and
// only to an owner it applies to. See rules/DECISIONS.md#d-117
import type { StoreSize } from "../db/db.ts";
import type { Store } from "../domain/store.ts";
import { NOISY_COMMENTS } from "../domain/tasks.ts";
import { computerHost } from "../environments/host.ts";
import { CATALOG } from "../integrations/catalog.ts";
import { ACTIVITY_REVIEW_NEWS } from "./activity-review.ts";
import { AGENT_FALLBACKS_NEWS } from "./agent-fallbacks.ts";
import { AGENT_PROMPTS_NEWS } from "./agent-prompts.ts";
import { BROWSER_EDIT_NEWS } from "./browser-edit.ts";
import { BROWSER_JAVASCRIPT_NEWS } from "./browser-javascript.ts";
import { BROWSER_SIGN_IN_NEWS } from "./browser-sign-in.ts";
import { CHANNEL_AGENTS_NEWS } from "./channel-agents.ts";
import { CHROME_TABS_NEWS } from "./chrome-tabs.ts";
import { COMPUTER_POINTER_NEWS } from "./computer-pointer.ts";
import { CONTACT_AGENT_NEWS } from "./contact-agent.ts";
import { EVENT_MUTE_NEWS } from "./event-mute.ts";
import { EXTERNAL_SESSIONS_NEWS } from "./external-sessions.ts";
import { HERMES_IMPORT_NEWS } from "./hermes-import.ts";
import { LOCAL_MODELS_NEWS } from "./local-models.ts";
import { MCP_CONTEXT_NEWS } from "./mcp-context.ts";
import { MOVE_BACKUP_NEWS } from "./move-backup.ts";
import { OLDER_NEWS } from "./older-entries.ts";
import { QUEUED_MESSAGES_NEWS } from "./queued-messages.ts";
import { QUICK_CHAT_NEWS } from "./quick-chat.ts";
import { ROOM_AGENT_NEWS } from "./room-agent.ts";
import { ROOM_HANDOFF_NEWS } from "./room-handoff.ts";
import { SIDE_QUESTION_NEWS } from "./side-question.ts";
import { STORE_COMPACT_NEWS } from "./store-compact.ts";
import { SUBPROJECTS_NEWS } from "./subprojects.ts";
import { TASK_COMMENTS_NEWS } from "./task-comments.ts";
import { TASK_GOALS_NEWS } from "./task-goals.ts";
import { TASK_REGROUP_NEWS } from "./task-regroup.ts";
import { WHATSAPP_GROUPS_NEWS } from "./whatsapp-groups.ts";

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
  /** A WhatsApp account is connected. */
  whatsapp?: boolean;
  /** Catalog integrations the owner connected (GitHub, Notion…). */
  integrations: number;
  /** The owner's private MCP connections, including project-limited ones. */
  mcp?: number;
  /** This core can run the isolated Linux computer (macOS, Linux or Windows) and the owner has a project to try there. */
  computer: boolean;
  /** This core runs on a Mac and the owner has work there (a project). */
  mac: boolean;
  /** The owner has Codex sessions whose account limits the panel can query. */
  codex: boolean;
  claude?: boolean;
  /** At least one paired Desktop can use coordinated remote updates. */
  desktop?: boolean;
  /** Open tasks with an agent on them. */
  tasks?: number;
  /** Open tasks whose comments piled up (worth cleaning). */
  noisyTasks?: number;
  /** A Hermes home folder is on this machine (moving from it is offered). */
  hermes?: boolean;
  /** A model app (Ollama, LM Studio) was found running on this computer. */
  localModels?: boolean;
  /** Agents that run on a model of their own (not the router alone). */
  ownModels?: number;
  /** Agents other than the super-agent with instructions of their own (a prompt worth reviewing). */
  promptedAgents?: number;
  /** The chats' database is over 500 MB and keeps its free space until it is rewritten once (compacted). */
  bigStore?: boolean;
  /** Projects the owner registered (the base project not counted). */
  projects?: number;
  /** A channel reads at least one room (a Discord channel, a group). */
  rooms?: boolean;
  /** Google Calendar's event reminders are on. */
  eventReminders?: boolean;
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
  {
    id: "email-retained-history",
    since: "2.13.5",
    title: {
      en: "Keep automatic mail without automatic replies",
      es: "Guardá correo automático sin respuestas automáticas",
    },
    about: {
      en: "Account notices and newsletters now stay in your Email chats. You can also recover older mail quietly from the terminal.",
      es: "Los avisos de cuentas y boletines ahora quedan en tus chats de Email. También podés recuperar correo anterior sin avisos desde la terminal.",
    },
    applies: (facts) => facts.email,
    text: "Email channels keep automatic mail that passes the account's existing sender checks and filters, without starting automatic replies. New mail can still be checked for importance. The owner can explicitly recover retained mailbox history with apx channels email-history, one bounded page at a time; it deduplicates stored messages and starts no replies, agent turns or alerts for history. Recovery is owner-only because importing private history must be an explicit choice. Never claim old mail has already been recovered; show verified counts and filtering limits.",
    actions: [
      {
        label: { en: "Check missing mail", es: "Revisar correo faltante" },
        prompt:
          "Help me check which Email messages are missing and explain how to recover retained mailbox history quietly.",
      },
    ],
  },

  MCP_CONTEXT_NEWS,
  EVENT_MUTE_NEWS,
  SUBPROJECTS_NEWS,
  ROOM_HANDOFF_NEWS,
  ACTIVITY_REVIEW_NEWS,
  AGENT_PROMPTS_NEWS,
  TASK_GOALS_NEWS,
  CHANNEL_AGENTS_NEWS,
  WHATSAPP_GROUPS_NEWS,
  CONTACT_AGENT_NEWS,
  ROOM_AGENT_NEWS,
  TASK_COMMENTS_NEWS,
  COMPUTER_POINTER_NEWS,
  TASK_REGROUP_NEWS,
  QUEUED_MESSAGES_NEWS,
  EXTERNAL_SESSIONS_NEWS,
  HERMES_IMPORT_NEWS,
  BROWSER_EDIT_NEWS,
  BROWSER_JAVASCRIPT_NEWS,
  QUICK_CHAT_NEWS,
  CHROME_TABS_NEWS,
  LOCAL_MODELS_NEWS,
  MOVE_BACKUP_NEWS,
  AGENT_FALLBACKS_NEWS,
  BROWSER_SIGN_IN_NEWS,
  STORE_COMPACT_NEWS,
  SIDE_QUESTION_NEWS,
  {
    id: "storage-screen",
    since: "2.13.0",
    title: { en: "See and free up APX's disk space", es: "Mirá y liberá el espacio que usa APX" },
    about: {
      en: "Settings › Storage shows what APX keeps on your computer by area, and Free up space clears caches and old logs. You can also delete an agents' computer or an old backup one by one. APX also tells you when your disk is almost full.",
      es: "Configuración › Almacenamiento muestra lo que APX guarda en tu computadora por área, y Liberar espacio borra la caché y los registros viejos. También podés borrar de a una las computadoras de los agentes o las copias viejas. APX también te avisa cuando tu disco está casi lleno.",
    },
    applies: () => true,
    text:
      "Settings, Storage now shows how much disk APX uses, split into chats and files, projects, the agents' " +
      "computers, the browser, local models, logs, caches and backups. Free up space removes only what APX makes " +
      "again by itself (caches and old logs) and says first how much; chats, memory, files and projects stay. When " +
      "the disk holding APX has less than 5 GB free, the panel says so with a link to that screen. Only the owner " +
      "frees space, from the screen. The agents' computers and the backups open into a list of each one, which " +
      "the owner deletes one by one after a confirmation (a computer only once it is off).",
    actions: [
      {
        label: { en: "Where do I see it?", es: "¿Dónde lo veo?" },
        prompt: "Tell me in two lines where I see how much disk APX uses and what Free up space removes.",
      },
    ],
  },
  {
    id: "plan-usage-tool",
    since: "2.13.0",
    title: { en: "Ask about your plan quotas", es: "Consultá las cuotas de tus planes" },
    about: {
      en: "Ask your agent how much is left on your AI plans and when they reset, for any engine on this computer, not just the ones in the top bar.",
      es: "Preguntale a tu agente cuánto te queda en tus planes de IA y cuándo se reinician, para cualquier motor de esta computadora, no solo los de la barra superior.",
    },
    applies: (facts) => Boolean(facts.claude || facts.codex),
    text: "When the owner asks about their AI plans, apx_settings method engines.usage reads the quotas of every engine detected on this computer, also those kept out of the top bar; params.query filters by engine id or provider/plan name. Claude and Codex currently report windows; other engines may be unsupported or unavailable. Keep checked_at and missing data explicit, never infer zero usage. This is a read-only query, not proactive monitoring or automatic stopping.",
    actions: [
      {
        label: { en: "Check plan quotas", es: "Consultar cuotas" },
        prompt: "Check the reported quotas and reset times for all my AI plans. Tell me which data is unavailable.",
      },
    ],
  },
  {
    id: "email-as-mail",
    since: "2.13.4",
    title: { en: "Received mail looks like mail", es: "El correo recibido se ve como correo" },
    about: {
      en: "Mail that reaches an Email account shows as it was sent, pictures hidden until you ask, and you can stop reading a sender or a whole domain from their card.",
      es: "El correo que llega a una cuenta de Email se ve como fue enviado, con las imágenes ocultas hasta que las pidas, y desde su ficha podés dejar de leer a un remitente o a todo un dominio.",
    },
    applies: (s) => s.email,
    text:
      "Mail that reaches the owner's Email account now shows in its chat as it was sent (formatting, links), with " +
      "pictures hidden until the owner shows them; the agent still reads only the words. Email accounts no longer " +
      "mail a code to strangers; they wait in Approvals. A sender's card can stop reading them or their whole domain, " +
      "and the account has a Never read list. The owner marks their own addresses by typing them, no code.",
    actions: [
      {
        label: { en: "Clean up my mail senders", es: "Ordenar mis remitentes" },
        prompt:
          "Look at who has written to my Email account and suggest which senders or domains I could stop reading.",
      },
    ],
  },
  {
    id: "email-cards",
    since: "2.13.0",
    title: { en: "Emails as cards in the chat", es: "Los emails, como tarjetas en el chat" },
    about: {
      en: "An email your agent writes shows as a card you can send from Gmail or an Email channel, with a few seconds to undo, or open in your mail app.",
      es: "Un email que escribe tu agente aparece como una tarjeta que podés mandar desde Gmail o un canal de Email, con unos segundos para deshacer, o abrir en tu app de correo.",
    },
    applies: () => true,
    text:
      "An email an agent writes for the owner now shows as a card in the chat, on the computer and on the phone. " +
      "With Gmail or an Email channel connected the owner sends it from the card, with a few seconds to undo; " +
      "otherwise it opens in their mail app, Gmail or Outlook on the web, or is copied. Mail that reaches an Email " +
      "channel shows the same way.",
    actions: [
      {
        label: { en: "Write one to try it", es: "Escribí uno para probarlo" },
        prompt: "Draft a short test email to me so I can see the new email card and how I send it from there.",
      },
    ],
  },
  {
    id: "help-whats-new",
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
    title: { en: "Your super-agent draws Flows for you", es: "Tu super-agente dibuja Flows por vos" },
    about: {
      en:
        "Ask in any chat for a Flow and your assistant draws it for you. Review it in the editor, or " +
        "ask it to turn it on and try it: it asks for your OK first.",
      es:
        "Pedí un Flow en cualquier chat y tu asistente lo dibuja por vos. Revisalo en el editor, o " +
        "pedile que lo prenda y lo pruebe: antes te pide el OK.",
    },
    applies: (f) => f.secretary,
    text: "The super-agent can now make a Flow in a project or change one's steps when the owner asks in any chat: it draws the steps, connects and places them, checks what keeps the drawing from running and fixes it. The chat shows the Flow's drawing with a button to open it in the editor. In the Flow editor itself, the Ask button opens a chat with the super-agent over the canvas: the owner says what to change and watches the steps appear as it draws them. What it saves is a draft: nothing runs until the owner turns it on, in the editor or by asking the super-agent, which shows a card with what the Flow sends, calls, runs and changes and waits for their OK; it can then run it once with sample data, after another OK, and say how each step went.",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
    since: "2.12.0",
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
  ...OLDER_NEWS,
];

/** Names of private MCP connections, without their configuration. */
const ownMcpServers = (store: Store): string[] => {
  try {
    const servers = JSON.parse(store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: object };
    return Object.keys(servers.mcpServers ?? {});
  } catch {
    return [];
  }
};
const connectedIntegrations = (store: Store): number => {
  const names = ownMcpServers(store);
  return CATALOG.filter((e) => names.includes(e.id)).length;
};

const signedIn = (store: Store, id: string) => Boolean(store.settings.get(`google_account:${id}`));

/** A store this big that cannot give space back is worth one compaction. */
const BIG_STORE_BYTES = 500 * 1024 * 1024;

export const newsFacts = (store: Store, o: { hermes?: boolean; storeSize?: StoreSize } = {}): NewsFacts => ({
  hermes: o.hermes ?? false,
  bigStore: o.storeSize !== undefined && !o.storeSize.incremental && o.storeSize.bytes >= BIG_STORE_BYTES,
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
  rooms: store.settings.read("channels").some((c) => (c.rooms?.rooms.length ?? 0) > 0),
  eventReminders: signedIn(store, "google-calendar") && store.settings.read("calendar_reminders").enabled,
  email: store.settings.read("channels").some((c) => c.type === "email" && c.email !== undefined),
  whatsapp: store.settings.read("channels").some((c) => c.type === "whatsapp"),
  integrations: connectedIntegrations(store),
  mcp: ownMcpServers(store).length,
  computer: computerHost() !== undefined && store.projects.list().length > 0,
  mac: process.platform === "darwin" && store.projects.list().length > 0,
  tasks: store.tasks.list({ state: "open", limit: 500 }).filter((t) => t.assignee).length,
  noisyTasks: store.tasks.noisy(NOISY_COMMENTS).length,
  localModels: store.settings.read("local_models_seen").length > 0,
  ownModels: store.agents.list().filter((a) => a.model_choice?.model).length,
  projects: store.projects.list().length,
  promptedAgents: store.agents.list().filter((a) => a.kind !== "secretary" && a.prompt.trim()).length,
});

/** The action a channel button stands for. */
export const newsAction = (entryId: string, index: number): NewsAction | undefined =>
  NEWS.find((e) => e.id === entryId)?.actions[index];
