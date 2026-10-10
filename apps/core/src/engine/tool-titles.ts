// An action card's title in the owner's language. Tools write theirs in English; these are the Spanish ones.
import type { Store } from "../domain/store.ts";
import type { Tool } from "../tools/types.ts";

type Args = Record<string, unknown>;

const str = (v: unknown, max = 80) => String(v ?? "").slice(0, max);
const file = (path: unknown, fallback: string) => (path ? String(path).split(/[\\/]/).at(-1) : fallback);
const host = (url: unknown) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url ?? "");
  }
};
const TASK_STATE: Record<string, string> = {
  open: "abierta",
  done: "hecha",
  dropped: "descartada",
  kept: "cumplida",
  missed: "incumplida",
  renegotiated: "renegociada",
};

/** Spanish titles for the built-in tools, by tool name. */
export const SPANISH_TITLES: Record<string, (a: Args) => string> = {
  video_transcript: (a) => `Miró ${str(a.url)}`,
  pass_request: (a) => `Pasó el pedido: ${str(a.summary)}`,
  search_owner_notes: (a) => `Buscó «${str(a.query, 60)}» en tus notas`,
  contact_requests: () => "Revisó quién está esperando",
  answer_contact_request: (a) => (a.decision === "answer" ? `Dejó pasar a ${str(a.code)}` : `Ignoró a ${str(a.code)}`),
  search_chats: (a) => `Buscó «${str(a.query, 60)}» en los chats`,
  read_chat: (a) => `Leyó el chat ${str(a.chat)}`,
  channel_list: () => "Revisó los canales",
  routine_list: (a) => (a.routine ? `Revisó la rutina ${str(a.routine)}` : "Revisó las rutinas"),
  routine_set: (a) => (a.routine ? `Cambió la rutina ${str(a.routine)}` : `Creó la rutina ${str(a.name)}`),
  contact_list: () => "Revisó los contactos",
  list_agents: () => "Buscó agentes",
  agent_set: (a) =>
    !a.agent
      ? `Creó el agente ${str(a.name ?? a.slug)}`
      : a.archive
        ? `Archivó a ${str(a.agent)}`
        : [a.slug, a.name, a.role, a.description, a.prompt, a.personality, a.parent].some((v) => v !== undefined)
          ? `Cambió a ${str(a.agent)}`
          : `Miró a ${str(a.agent)}`,
  grant_tool: (a) =>
    `Dejó que ${str(a.agent ?? "un agente")} use ${(Array.isArray(a.tools) ? a.tools : []).join(", ").slice(0, 60)}`,
  delegate: (a) => {
    const worker = a.worker as { name?: unknown } | undefined;
    return `Le pidió a ${str(worker?.name ?? a.agent ?? a.session)}`;
  },
  list_sessions: () => "Buscó sesiones",
  browser_open: (a) => `Abrió ${host(a.url)}`,
  browser_navigate: (a) => `Fue a ${host(a.url)}`,
  browser_snapshot: () => "Leyó la página",
  browser_text: () => "Leyó el texto",
  browser_click: (a) => `Hizo clic en ${str(a.ref)}`,
  browser_type: (a) => `Escribió en ${str(a.ref)}`,
  browser_use_my_login: (a) => `Usó tu sesión en ${str(a.domain)}`,
  browser_handoff: (a) => `Te pidió: ${str(a.reason, 60)}`,
  message_contact: (a) => `Le escribió a ${str(a.to ?? "un contacto")}`,
  channel_post: (a) => (a.room ? `Publicó en #${str(a.room).replace(/^#/, "")}` : "Publicó en una sala"),
  open_document: (a) => `Abrió el documento ${a.title ? str(a.title) : file(a.path, "")}`,
  shell: (a) => `Ejecutó ${str(a.command, 60)}`,
  shell_output: () => "Leyó la salida de un proceso",
  shell_kill: () => "Detuvo un proceso",
  imessage_read: (a) => (a.with ? `Leyó los iMessages con ${str(a.with)}` : "Leyó los últimos iMessages"),
  imessage_send: (a) => `Envió un iMessage a ${str(a.to ?? "alguien")}`,
  remember: (a) => `Recordó: ${str(a.text)}`,
  recall: (a) => `Buscó «${str(a.query, 60)}» en la memoria`,
  forget: (a) => `Olvidó la nota ${str(a.id)}`,
  show_widget: (a) => `Hizo el widget ${str(a.title ?? a.name)}`,
  read_widget: (a) => (a.name ? `Leyó el widget ${str(a.name)}` : "Listó los widgets"),
  edit_widget: (a) => `Editó el widget ${str(a.name)}`,
  web_search: (a) => `Buscó ${str(a.query)}`,
  web_read: (a) => (a.url ? `Leyó ${host(a.url)}` : "Leyó una página"),
  phone_location: () => "Vio dónde está tu teléfono",
  phone_photo: () => "Pidió una foto a tu teléfono",
  screen_snapshot: (a) => (a.app ? `Miró ${str(a.app)} en tu pantalla` : "Miró tu pantalla"),
  screen_click: (a) => `Hizo clic en ${str(a.app) || "una app"}`,
  screen_type: (a) => `Escribió en ${str(a.app) || "una app"}`,
  screen_key: (a) => `Apretó ${str(a.keys)} en ${str(a.app) || "una app"}`,
  screen_open: (a) => `Abrió ${str(a.url ?? a.app)}${a.url && a.app ? ` en ${str(a.app)}` : ""}`,
  task_list: () => "Revisó las tareas",
  task_create: (a) => `Creó la tarea ${str(a.title, 60)}`,
  task_update: (a) => `Actualizó la tarea ${str(a.task)}`,
  task_comment: (a) => `Comentó en ${str(a.task)}`,
  task_close: (a) => `Marcó ${str(a.task)} como ${TASK_STATE[str(a.state)] ?? str(a.state)}`,
  commitment_settle: (a) => `Marcó ${str(a.task)} como ${TASK_STATE[str(a.outcome)] ?? str(a.outcome)}`,
  send_file: (a) => `Adjuntó ${file(a.path, "un archivo")}`,
  voice_replies: (a) => (a.on ? "Activó las respuestas habladas" : "Desactivó las respuestas habladas"),
  make_image: (a) => `Dibujó: ${str(a.prompt)}`,
  ask_owner: (a) => `Te preguntó: ${str(a.question, 60)}`,
  notify_owner: (a) => `Te avisó: ${str(a.text, 60)}`,
  read_output: () => "Leyó más de una salida",
  load_skill: (a) => `Cargó la habilidad ${str(a.name)}`,
  file_read: (a) => `Leyó ${str(a.path ?? "un archivo")}`,
  file_write: (a) => `Escribió ${str(a.path ?? "un archivo")}`,
  file_edit: (a) => `Editó ${str(a.path ?? "un archivo")}`,
};

/** The card title for a call: the tool's own (English) unless the owner reads Spanish and there is one for it. */
export function toolTitle(store: Store, tool: Tool, args: Args): string {
  const spanish = store.settings.get("owner_language") === "en" ? undefined : SPANISH_TITLES[tool.name];
  if (!spanish) return tool.title(args);
  try {
    return spanish(args);
  } catch {
    return tool.title(args);
  }
}
