import type { Lang } from "../i18n/index.ts";

/** One portrait: the blob it draws, the file it is drawn with, and that file's text. */
export type Scene = { key: string; file: string; text: string };

const agentFile = (fm: Array<[string, string]>, body: string) =>
  `---\n${fm.map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}`;

// The landing's crew: an agent is a markdown file, and it remembers in another one.
const SCENES: Record<Lang, Scene[]> = {
  en: [
    {
      key: "perla",
      file: "tomas.md",
      text: agentFile(
        [
          ["name", "Tomás"],
          ["role", "Developer"],
          ["description", "Keeps the online store running: checkout, catalog and payments."],
          ["runtime", "claude-code"],
          ["icon", "perla"],
        ],
        "You are Tomás, the developer. Reproduce first, fix second, and always say which test proves it.",
      ),
    },
    {
      key: "papa",
      file: "night/memory.md",
      text: "# memory · night shift\n- Backups at 3:00, report at 9:00.\n- If a routine fails twice, tell Nova, not the owner.\n- Keep the log short: what ran, what broke, what is next.",
    },
    {
      key: "orbita",
      file: "lucia.md",
      text: agentFile(
        [
          ["name", "Lucía"],
          ["role", "Product manager"],
          ["description", "Owns the Acme Store roadmap and hands out the work."],
          ["autonomy", "total"],
          ["icon", "orbita"],
        ],
        "You are Lucía, product manager at Acme Store. Split big asks into tasks, assign them, and follow up until they close.",
      ),
    },
    {
      key: "menta",
      file: "nova/memory.md",
      text: "# memory · nova\n- The owner reads Telegram first thing, WhatsApp after lunch.\n- Never wake them for less than a blocker.\n- Weekly report goes out Mondays at 9:00.",
    },
    {
      key: "caracol",
      file: "vera.md",
      text: agentFile(
        [
          ["name", "Vera"],
          ["role", "Marketing"],
          ["description", "Writes campaigns, newsletters and social posts."],
          ["skills", "[newsletter, social-posts]"],
          ["icon", "caracol"],
        ],
        "You are Vera. Short copy, one idea per post, and nothing goes out without a date.",
      ),
    },
    {
      key: "parche",
      file: "desk/memory.md",
      text: "# memory · whatsapp desk\n- Answer saved contacts only.\n- Orders: say it ships, never promise a date.\n- Anything about money goes to the owner on Telegram.",
    },
  ],
  es: [
    {
      key: "perla",
      file: "tomas.md",
      text: agentFile(
        [
          ["name", "Tomás"],
          ["role", "Desarrollador"],
          ["description", "Mantiene la tienda online andando: checkout, catálogo y pagos."],
          ["runtime", "claude-code"],
          ["icon", "perla"],
        ],
        "Sos Tomás, el desarrollador. Primero reproducí, después arreglá, y siempre decí qué test lo prueba.",
      ),
    },
    {
      key: "papa",
      file: "night/memory.md",
      text: "# memoria · turno noche\n- Backups a las 3:00, reporte a las 9:00.\n- Si una rutina falla dos veces, avisale a Nova, no al dueño.\n- Log corto: qué corrió, qué se rompió, qué sigue.",
    },
    {
      key: "orbita",
      file: "lucia.md",
      text: agentFile(
        [
          ["name", "Lucía"],
          ["role", "Product manager"],
          ["description", "Es dueña del roadmap de Acme Store y reparte el trabajo."],
          ["autonomy", "total"],
          ["icon", "orbita"],
        ],
        "Sos Lucía, product manager de Acme Store. Dividí los pedidos grandes en tareas, asignalas y seguilas hasta que se cierren.",
      ),
    },
    {
      key: "menta",
      file: "nova/memory.md",
      text: "# memoria · nova\n- El dueño lee Telegram a primera hora y WhatsApp después de almorzar.\n- Nunca lo despiertes por menos que un bloqueo.\n- El reporte semanal sale los lunes a las 9:00.",
    },
    {
      key: "caracol",
      file: "vera.md",
      text: agentFile(
        [
          ["name", "Vera"],
          ["role", "Marketing"],
          ["description", "Escribe campañas, newsletters y posteos para redes."],
          ["skills", "[newsletter, social-posts]"],
          ["icon", "caracol"],
        ],
        "Sos Vera. Textos cortos, una idea por posteo, y nada sale sin fecha.",
      ),
    },
    {
      key: "parche",
      file: "desk/memory.md",
      text: "# memoria · mesa de whatsapp\n- Contestá sólo a contactos guardados.\n- Pedidos: decí que sale, nunca prometas una fecha.\n- Todo lo de plata va al dueño por Telegram.",
    },
  ],
};

export const scenesFor = (language: Lang) => SCENES[language];
