import type { NewsEntry } from "./entries.ts";

export const OLDER_NEWS: readonly NewsEntry[] = [
  {
    id: "device-text-size",
    since: "2.12.0",
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
    since: "2.12.0",
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
        "and Twitch. Set each one up in Channels.",
      es:
        "Ahora podés hablar con tus agentes por iMessage, Google Chat, SMS, ntfy, Nextcloud " +
        "Talk, IRC y Twitch. Configurá cada uno en Canales.",
    },
    applies: (f) => f.channels > 0,
    text:
      "Agents can now be reached on more apps: iMessage on the owner's Mac, Google Chat, SMS through Twilio, ntfy " +
      "push notifications, Nextcloud Talk, IRC and Twitch chat. Each is set up in Channels, like the others.",
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
        "Connect Microsoft Teams and LINE in Channels. Their screen first helps you " +
        "turn on a public address so the apps can reach you.",
      es:
        "Conectá Microsoft Teams y LINE en Canales. Su pantalla te ayuda primero a " +
        "activar una dirección pública para que las apps puedan llegar hasta vos.",
    },
    applies: (f) => f.channels > 0,
    text:
      "Agents can now be reached on Microsoft Teams and LINE. Both send their messages to a web address, so their " +
      "screen in Channels turns on a public address first: Tailscale Funnel (a fixed address), ngrok " +
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
