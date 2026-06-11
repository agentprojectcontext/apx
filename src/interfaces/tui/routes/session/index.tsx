/**
 * APX session chat view.
 *
 * Streams turns through the APX daemon and renders them OpenCode-style:
 *  - user bubbles with a left accent bar (greyed while queued)
 *  - assistant turns as ordered parts: Thinking blocks, tool calls
 *    (→ read, * glob, …) and the markdown answer
 *  - click a message to open the Message Actions menu (Copy / Fork / Remove)
 *  - send while a turn is in flight → the message is queued and flushed after
 *
 * The APX-tailored sidebar shows session / agent / model / context usage.
 */
import { For, Show, createMemo, createEffect, onCleanup } from "solid-js"
import { MouseButton } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useApxSync } from "@tui/context/sync-apx"
import { useSDK } from "@tui/context/sdk-apx"
import { useLocal } from "@tui/context/local"
import { Toast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { usePromptRef } from "@tui/context/prompt"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { ApxMessage, ApxPart } from "@tui/context/sync-apx"
import { SidebarApx } from "./sidebar-apx"
import { MessageActions } from "./message-actions"

/** Split a daemon error like "fetch failed (trace: abc-123)" into message + trace. */
function parseError(raw: string): { message: string; trace?: string; hint?: string } {
  const m = raw.match(/^([\s\S]*?)\s*\(trace:\s*([^)]+)\)\s*$/)
  const message = (m ? m[1] : raw).trim()
  const trace = m ? m[2].trim() : undefined
  let hint: string | undefined
  if (/fetch failed/i.test(message))
    hint = "No se pudo contactar el modelo. Verificá que el proveedor esté disponible (p. ej. Ollama corriendo)."
  else if (/not enabled/i.test(message)) hint = "El super-agent está deshabilitado en ~/.apx/config.json."
  else if (/\b401\b|unauthorized|api[_ ]?key/i.test(message)) hint = "Revisá la API key del proveedor en ~/.apx/config.json."
  return { message, trace, hint }
}

// Coding modes (mirrors web Code). Only Build is wired today; Plan/Zen are
// shown as the active label is "Build" until a mode toggle lands.
const MODES = ["Build", "Plan", "Zen"] as const

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  search_files: "Search",
  list_files: "List",
  run_shell: "Shell",
  load_skill: "Skill",
}

const MAX_DIFF_LINES = 24

/** Git-style diff block: removed lines in red (-), added lines in green (+). */
function DiffBlock(props: { search?: string; replace?: string; content?: string }) {
  const { theme } = useTheme()
  const removed = () => (props.search ? props.search.replace(/\n$/, "").split("\n") : [])
  const added = () => ((props.replace ?? props.content) ? (props.replace ?? props.content ?? "").replace(/\n$/, "").split("\n") : [])
  const shown = () => {
    const r = removed().map((t) => ({ sign: "-", t, color: theme.error }))
    const a = added().map((t) => ({ sign: "+", t, color: theme.success }))
    const all = [...r, ...a]
    return all.length > MAX_DIFF_LINES
      ? [...all.slice(0, MAX_DIFF_LINES), { sign: " ", t: `… ${all.length - MAX_DIFF_LINES} more lines`, color: theme.textMuted }]
      : all
  }
  return (
    <box flexDirection="column" marginLeft={2} marginTop={0} backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
      <For each={shown()}>
        {(line) => (
          <text color={line.color}>
            {line.sign} {line.t}
          </text>
        )}
      </For>
    </box>
  )
}

function ToolPart(props: { part: Extract<ApxPart, { kind: "tool" }> }) {
  const { theme } = useTheme()
  const color = () => (props.part.running ? theme.warning ?? theme.primary : props.part.ok === false ? theme.error : theme.success)
  const marker = () => (props.part.running ? "▸" : props.part.ok === false ? "✗" : "→")
  const label = () => TOOL_LABELS[props.part.name] ?? props.part.name
  const a = () => (props.part.args && typeof props.part.args === "object" ? (props.part.args as any) : {})
  const target = () => a().path ?? a().filePath ?? a().file ?? a().pattern ?? a().query ?? a().command ?? ""
  const isEdit = () => props.part.name === "edit_file" && (a().search || a().replace)
  const isWrite = () => props.part.name === "write_file" && a().content
  return (
    <box flexDirection="column">
      <text color={color()}>
        {marker()} {label()}
        {target() ? " " + (String(target()).length > 60 ? String(target()).slice(0, 57) + "…" : target()) : ""}
      </text>
      <Show when={isEdit()}>
        <DiffBlock search={a().search} replace={a().replace} />
      </Show>
      <Show when={isWrite()}>
        <DiffBlock content={a().content} />
      </Show>
    </box>
  )
}

function AssistantBubble(props: {
  msg: ApxMessage
  onActivate: () => void
  agentName: string
  modelLabel: string
  mode: string
}) {
  const { theme, syntax } = useTheme()
  const parts = createMemo<ApxPart[]>(() => {
    const p = props.msg.parts
    if (p && p.length) return p
    // Fallback for plain-text messages with no parts.
    return props.msg.text ? [{ kind: "text", text: props.msg.text }] : []
  })
  const empty = () => parts().length === 0
  // OpenCode-style meta line shown after the answer: mode · model · response time.
  const elapsed = () => {
    if (!props.msg.completedAt) return ""
    return `${((props.msg.completedAt - props.msg.createdAt) / 1000).toFixed(1)}s`
  }
  const meta = () => {
    const parts = [props.mode, props.msg.model || props.modelLabel, elapsed()].filter(Boolean)
    return parts.join("  ·  ")
  }
  return (
    <box
      flexDirection="column"
      marginTop={1}
      marginBottom={1}
      paddingLeft={2}
      paddingRight={2}
      onMouseDown={(e: any) => {
        // Left click (or plain click w/o button info) opens Message Actions.
        if (e?.button === undefined || e.button === MouseButton.LEFT) props.onActivate()
      }}
    >
      <text color={theme.success} bold marginBottom={1}>
        {props.msg.streaming ? `${props.agentName} ▸` : props.agentName}
      </text>
      <Show when={!empty()} fallback={<text color={theme.textMuted}>…</text>}>
        <box flexDirection="column">
          <For each={parts()}>
            {(part) => {
              if (part.kind === "thinking")
                return (
                  <text color={theme.textMuted} italic wrap>
                    Thinking: {part.text}
                  </text>
                )
              if (part.kind === "tool") return <ToolPart part={part} />
              // text part → markdown
              return (
                <box flexShrink={0}>
                  <code
                    filetype="markdown"
                    drawUnstyledText={false}
                    streaming={props.msg.streaming ?? false}
                    syntaxStyle={syntax()}
                    content={part.text.trim()}
                    conceal={true}
                    fg={theme.text}
                  />
                </box>
              )
            }}
          </For>
        </box>
      </Show>
      <Show when={!props.msg.streaming && !props.msg.error}>
        <box flexDirection="row" marginTop={1}>
          <text color={theme.primary}>■ </text>
          <text color={theme.textMuted}>{meta()}</text>
        </box>
      </Show>
    </box>
  )
}

function UserBubble(props: { msg: ApxMessage; onActivate: () => void }) {
  const { theme } = useTheme()
  const queued = () => props.msg.queued === true
  const accent = () => (queued() ? theme.textMuted : theme.primary)
  return (
    <box
      flexDirection="row"
      marginTop={1}
      marginBottom={1}
      paddingLeft={2}
      paddingRight={2}
      onMouseDown={(e: any) => {
        // Left click (or plain click w/o button info) opens Message Actions.
        if (e?.button === undefined || e.button === MouseButton.LEFT) props.onActivate()
      }}
    >
      {/* single colored accent bar on the left + filled background (OpenCode style) */}
      <box width={1} backgroundColor={accent()} flexShrink={0} />
      <box
        flexDirection="column"
        flexGrow={1}
        minWidth={0}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
      >
        <text color={queued() ? theme.textMuted : theme.text} wrap>
          {props.msg.text}
        </text>
        <Show when={queued()}>
          <text color={theme.textMuted} italic>
            queued · click to send now
          </text>
        </Show>
      </box>
    </box>
  )
}

function ErrorBubble(props: { msg: ApxMessage }) {
  const { theme } = useTheme()
  const parsed = createMemo(() => parseError(props.msg.text))
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <text color={theme.error} bold>
        ⚠ Error
      </text>
      <text color={theme.error} wrap>
        {parsed().message}
      </text>
      <Show when={parsed().hint}>{(hint) => <text color={theme.textMuted} wrap>{hint()}</text>}</Show>
      <Show when={parsed().trace}>{(trace) => <text color={theme.textMuted}>trace: {trace()}</text>}</Show>
    </box>
  )
}

function ShellBubble(props: { msg: ApxMessage }) {
  const { theme } = useTheme()
  const header = () => {
    const code = props.msg.exitCode
    const status = props.msg.streaming ? "running" : code === 0 ? "exit 0" : code == null ? "ended" : `exit ${code}`
    return `$ ${props.msg.command ?? ""}  · ${status}`
  }
  const body = () => props.msg.text || (props.msg.streaming ? "…" : "(no output)")
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <text color={theme.warning ?? theme.primary} bold>
        {header()}
      </text>
      <text color={props.msg.exitCode && props.msg.exitCode !== 0 ? theme.error : theme.text} wrap>
        {body()}
      </text>
    </box>
  )
}

export function Session() {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const route = useRoute()
  const sync = useApxSync()
  const sdk = useSDK()
  const local = useLocal()
  const dialog = useDialog()
  const promptRef = usePromptRef()

  // Show the sidebar only on wide terminals; on narrow ones the chat keeps
  // full width (the directory/branch live in the sidebar, shown when wide).
  const wide = createMemo(() => dims().width >= 100)

  // Bridge the user's /models selection into the SDK so the next turn uses it.
  createEffect(() => {
    const m = local.model?.parsed?.()
    if (m?.modelID) sdk.setModel?.(m.providerID ? `${m.providerID}:${m.modelID}` : m.modelID)
  })

  const sessionID = createMemo(() => {
    if (route.data.type === "session") return route.data.sessionID
    return sync.session.current() ?? ""
  })

  // Keep the sync store's "current session" pinned to the session we're viewing
  // so the sidebar/usage track the right bucket.
  createEffect(() => {
    const id = sessionID()
    if (id) sync.session.setCurrent(id)
  })

  const messages = createMemo(() => sync.session.messages(sessionID()))

  // Active mode + model, shown after each answer (mode · model · response time).
  const mode = createMemo(() => MODES[0]) // Build (Plan/Zen toggle: future work)
  const modelLabel = createMemo(() => {
    const parsed = local.model?.parsed?.()
    if (parsed?.modelID) return parsed.providerID ? `${parsed.providerID}:${parsed.modelID}` : parsed.modelID
    return sdk.model || "—"
  })
  const agentName = createMemo(() => {
    const a = sdk.agent || "Assistant"
    return a.charAt(0).toUpperCase() + a.slice(1)
  })

  onCleanup(() => {
    promptRef.set(undefined)
  })

  function openActions(msg: ApxMessage) {
    dialog.replace(() => <MessageActions sessionID={sessionID()} message={msg} />)
  }

  return (
    <box flexDirection="column" flexGrow={1} width={dims().width} height={dims().height}>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        {/* Chat column */}
        <box flexDirection="column" flexGrow={1} minWidth={0}>
          <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" verticalScrollbarOptions={{ visible: true }}>
            <box flexDirection="column" paddingTop={1}>
              <Show
                when={messages().length > 0}
                fallback={
                  <box paddingLeft={2} paddingTop={2}>
                    <text color={theme.textMuted} italic>
                      Type a message to chat, or prefix with ! to run a shell command (e.g. !ls).
                    </text>
                  </box>
                }
              >
                <For each={messages()}>
                  {(msg) => {
                    if (msg.role === "user") return <UserBubble msg={msg} onActivate={() => openActions(msg)} />
                    if (msg.role === "shell") return <ShellBubble msg={msg} />
                    if (msg.error) return <ErrorBubble msg={msg} />
                    return (
                      <AssistantBubble
                        msg={msg}
                        onActivate={() => openActions(msg)}
                        agentName={agentName()}
                        modelLabel={modelLabel()}
                        mode={mode()}
                      />
                    )
                  }}
                </For>
              </Show>
              <box height={1} />
            </box>
          </scrollbox>

          {/* Input — the OpenCode prompt component (colored box, Build/Plan mode
              selector, model label, Enter-to-send). With sessionID set it streams
              to the *current* session via session.prompt instead of creating a
              new one. This is also what fixes Enter submission and focus, since
              the prompt owns the keymap submit wiring. */}
          <box flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
            <Prompt
              sessionID={sessionID()}
              visible={true}
              ref={(r?: PromptRef) => promptRef.set(r)}
              placeholders={{
                normal: ["Ask anything…", "Fix a TODO in the codebase", "Explain this code"],
                shell: ["ls -la", "git status", "pwd"],
              }}
            />
          </box>
        </box>

        {/* Sidebar — only on wide terminals; carries the directory + branch */}
        <Show when={wide()}>
          <SidebarApx sessionID={sessionID()} />
        </Show>
      </box>
      <Toast />
    </box>
  )
}
