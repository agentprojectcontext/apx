// Channel-aware pre-processor for surfaces that drive the super-agent loop
// from a voice/deck/desktop entrypoint.
//
// Each surface has different ergonomics: how long the reply can be, whether
// the UI can render structured suggestion chips, what the default project
// resolution should be. buildVoiceChannelContext() is the single place where
// those decisions live. Callers (api/voice.js today; any future overlay or
// device adapter tomorrow) pass the channel string + dynamic context and
// receive the context note + system suffix to feed into the super-agent.
//
// Shape:
//   contextNote   — prepended to the prompt (dynamic, per-request)
//   systemSuffix  — concatenated onto the system prompt (per-surface rules)
//   wantsSuggestions — whether the surface can render the trailing
//                      `suggestions` JSON block (deck/desktop UI can; raw
//                      Telegram cannot)
//   channel       — resolved surface ("deck"/"desktop"/"telegram"/…)
//   channelMeta   — surface metadata (e.g. `{ voice: true }` flags spoken mode)
import { CHANNELS } from "../../constants/channels.js";

// Balanced suggestions instruction. An earlier, more aggressive version
// ("EJECUTA, no narres — LLAMÁ A LA TOOL") made Gemini call tools for
// EVERYTHING, even "hola" → send_telegram("hola"). The rule below gates
// tool use on a *clear* action request and explicitly tells the model to
// just talk for chit-chat.
export const SUGGESTIONS_INSTRUCTION = `

# Cuándo usar tools
SOLO llamá una tool cuando el usuario pide CLARAMENTE una acción
concreta: "creá una tarea …", "mandá un telegram …", "listá …",
"abrí …", "marcá como hecha …". En esos casos ejecutá la tool (no
digas "lo voy a hacer" — hacelo) y después confirmá en una frase corta
en castellano lo que YA hiciste.

Si el mensaje es un saludo, una pregunta, o charla ("hola", "cómo
andás", "qué podés hacer") NO llames ninguna tool: respondé en texto,
breve, en castellano.

Nunca llames la misma tool dos veces en el mismo turno.

# Sugerencias (opcional)
Al final, en su propia línea, podés agregar un bloque fenced
\`suggestions\` con 2-3 próximos pasos. El usuario NO lo ve (la deck lo
quita):
\`\`\`suggestions
[{"label":"Ver tareas","command":"deck.view:tasks"}]
\`\`\`
Si no hay próximos pasos útiles, omití el bloque.`;

function buildLanguageDirective(language) {
  return language === "es"
    ? "IMPORTANT: Reply ALWAYS in Spanish (rioplatense/Argentina). The user speaks Spanish."
    : `IMPORTANT: Reply in language "${language}".`;
}

function buildProjectHint(projectId) {
  // Project resolution hint:
  //   per-project mic (projectId set): use it imperatively, don't ask.
  //   global deck mic (no projectId): default to project id=0 ("default")
  //     for actions unless the user names a project out loud.
  return projectId
    ? `\nThe active project is id=${projectId}. For ANY task/note/list ` +
      `action, pass project_id=${projectId} automatically. Do NOT ask the ` +
      `user which project — only switch if they explicitly name another.`
    : `\nThis is the GLOBAL mic (no project in focus). For task/note/list ` +
      `actions, default to project_id=0 ("default") UNLESS the user names ` +
      `a project out loud (e.g. "en evolution-registry…", "en el proyecto ` +
      `apx…") — then resolve that project by name. Never ask "¿en qué ` +
      `proyecto?"; pick the default and act.`;
}

export function buildVoiceChannelContext(channel, { projectId, language = "es" } = {}) {
  const base = {
    contextNote: "",
    systemSuffix: "",
    wantsSuggestions: false,
    channel: "",
    channelMeta: {},
  };
  const dynamicNote = `${buildLanguageDirective(language)}${buildProjectHint(projectId)}`;

  // Channels are surfaces; "voice" is NOT a surface — it's the spoken MODE of
  // the deck. All channel FORMATTING lives in channels/*.md + modes/voice.md
  // (injected by buildSuperAgentSystem); contextNote here carries ONLY
  // per-request dynamic bits (language + project).
  switch (channel) {
    case "voice":
      return { ...base, contextNote: dynamicNote, systemSuffix: SUGGESTIONS_INSTRUCTION, wantsSuggestions: true, channel: CHANNELS.DECK, channelMeta: { voice: true } };
    case CHANNELS.DECK:
      return { ...base, contextNote: dynamicNote, systemSuffix: SUGGESTIONS_INSTRUCTION, wantsSuggestions: true, channel: CHANNELS.DECK, channelMeta: {} };
    case CHANNELS.DESKTOP:
      return { ...base, contextNote: dynamicNote, systemSuffix: SUGGESTIONS_INSTRUCTION, wantsSuggestions: true, channel: CHANNELS.DESKTOP, channelMeta: { voice: true } };
    case CHANNELS.TELEGRAM:
      return { ...base, contextNote: dynamicNote, channel: CHANNELS.TELEGRAM, channelMeta: {} };
    default:
      return { ...base, contextNote: dynamicNote, channel: channel || CHANNELS.API, channelMeta: {} };
  }
}
