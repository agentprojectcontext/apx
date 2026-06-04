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
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js"
import { TextareaRenderable, MouseButton } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useApxSync } from "@tui/context/sync-apx"
import { useSDK } from "@tui/context/sdk-apx"
import { useLocal } from "@tui/context/local"
import { useToast, Toast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { useExit } from "@tui/context/exit"
import { usePromptRef } from "@tui/context/prompt"
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

/** One-line summary of a tool call, e.g. `read src/app.tsx` or `glob "**​/*.ts"`. */
function toolSummary(part: Extract<ApxPart, { kind: "tool" }>): string {
  const a = part.args
  let detail = ""
  if (a && typeof a === "object") {
    detail =
      a.filePath ?? a.path ?? a.file ?? a.pattern ?? a.query ?? a.command ?? a.url ?? a.description ?? ""
    if (!detail) {
      const first = Object.values(a).find((v) => typeof v === "string") as string | undefined
      detail = first ?? ""
    }
  } else if (typeof a === "string") {
    detail = a
  }
  if (detail.length > 60) detail = detail.slice(0, 57) + "…"
  return detail ? `${part.name} ${detail}` : part.name
}

function ToolPart(props: { part: Extract<ApxPart, { kind: "tool" }> }) {
  const { theme } = useTheme()
  const color = () => (props.part.running ? theme.warning ?? theme.primary : props.part.ok === false ? theme.error : theme.success)
  const marker = () => (props.part.running ? "▸" : props.part.ok === false ? "✗" : "→")
  return (
    <text color={color()}>
      {marker()} {toolSummary(props.part)}
    </text>
  )
}

function AssistantBubble(props: { msg: ApxMessage; onActivate: () => void }) {
  const { theme, syntax } = useTheme()
  const parts = createMemo<ApxPart[]>(() => {
    const p = props.msg.parts
    if (p && p.length) return p
    // Fallback for plain-text messages with no parts.
    return props.msg.text ? [{ kind: "text", text: props.msg.text }] : []
  })
  const empty = () => parts().length === 0
  return (
    <box
      flexDirection="column"
      marginBottom={1}
      paddingLeft={2}
      paddingRight={2}
      onMouseDown={(e: any) => {
        // Left click (or plain click w/o button info) opens Message Actions.
        if (e?.button === undefined || e.button === MouseButton.LEFT) props.onActivate()
      }}
    >
      <text color={theme.success} bold>
        {props.msg.streaming ? `${props.msg.role === "assistant" ? "Assistant" : "Assistant"} ▸` : "Assistant"}
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
    </box>
  )
}

function UserBubble(props: { msg: ApxMessage; onActivate: () => void }) {
  const { theme } = useTheme()
  const queued = () => props.msg.queued === true
  return (
    <box
      flexDirection="row"
      marginBottom={1}
      paddingRight={2}
      onMouseDown={(e: any) => {
        // Left click (or plain click w/o button info) opens Message Actions.
        if (e?.button === undefined || e.button === MouseButton.LEFT) props.onActivate()
      }}
    >
      {/* left accent bar */}
      <box width={1} backgroundColor={queued() ? theme.textMuted : theme.primary} flexShrink={0} />
      <box flexDirection="column" flexGrow={1} paddingLeft={1} backgroundColor={theme.backgroundElement}>
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
  const toast = useToast()
  const dialog = useDialog()
  const exit = useExit()
  const promptRef = usePromptRef()
  const [sending, setSending] = createSignal(false)
  let inputEl: TextareaRenderable | undefined

  // Bridge the user's /models selection into the SDK so the next turn uses it.
  createEffect(() => {
    const m = local.model?.parsed?.()
    if (m?.modelID) sdk.setModel?.(m.providerID ? `${m.providerID}:${m.modelID}` : m.modelID)
  })

  const sessionID = createMemo(() => {
    if (route.data.type === "session") return route.data.sessionID
    return sync.session.current() ?? ""
  })

  const messages = createMemo(() => sync.session.messages(sessionID()))

  onCleanup(() => {
    promptRef.set(undefined)
  })

  function openActions(msg: ApxMessage) {
    dialog.replace(() => <MessageActions sessionID={sessionID()} message={msg} />)
  }

  function makeRef(r: TextareaRenderable) {
    return {
      get focused() {
        return r.focused
      },
      get current() {
        return { input: r.plainText, parts: [] as any[] }
      },
      set(prompt: { input: string; parts: any[] }) {
        r.setText(prompt.input)
      },
      reset() {
        r.clear()
      },
      blur() {
        r.blur()
      },
      focus() {
        r.focus()
      },
      submit() {
        void handleSubmit()
      },
    }
  }

  async function handleSubmit() {
    if (!inputEl) return
    const text = inputEl.plainText.trim()
    if (!text) return

    if (text === "exit" || text === "quit" || text === ":q") {
      void exit()
      return
    }

    inputEl.clear()

    // Shell command
    if (text.startsWith("!") && text.length > 1) {
      try {
        await sync.runShell(text.slice(1).trim())
      } catch (e) {
        toast.error(e instanceof Error ? e : new Error(String(e)))
      }
      return
    }

    // A turn is already in flight → queue it (OpenCode behaviour).
    if (sending()) {
      const id = sync.queueMessage(text)
      if (!id) toast.show({ message: "No hay sesión activa todavía", variant: "warning" })
      else toast.show({ message: "Mensaje en cola", variant: "info" })
      return
    }

    setSending(true)
    try {
      await sync.sendMessage(text)
      // Flush any messages queued while this turn was streaming.
      let next = messages().find((m) => m.queued)
      while (next) {
        await sync.sendQueued(sessionID(), next.id)
        next = messages().find((m) => m.queued)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setSending(false)
    }
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
                    return <AssistantBubble msg={msg} onActivate={() => openActions(msg)} />
                  }}
                </For>
              </Show>
              <box height={1} />
            </box>
          </scrollbox>

          {/* Input area */}
          <box flexShrink={0} flexDirection="column" borderTop={1} borderColor={theme.border} backgroundColor={theme.backgroundElement}>
            <box paddingLeft={2} paddingRight={2} paddingTop={1}>
              <textarea
                ref={(r: TextareaRenderable) => {
                  inputEl = r
                  promptRef.set(makeRef(r))
                }}
                placeholder={sending() ? "Streaming… (enter to queue)" : "Ask anything... (prefix ! to run shell, e.g. !ls)"}
                placeholderColor={theme.textMuted}
                textColor={theme.text}
                focusedTextColor={theme.text}
                minHeight={1}
                maxHeight={6}
                onSubmit={() => {
                  setTimeout(() => setTimeout(() => handleSubmit(), 0), 0)
                }}
              />
            </box>
            <box height={1} paddingLeft={2} paddingRight={2} justifyContent="space-between" flexDirection="row">
              <Show
                when={sending()}
                fallback={<text color={theme.textMuted}>enter send · ! shell · click msg for actions · exit quit</text>}
              >
                <text color={theme.warning ?? theme.primary} italic>
                  ▸ Streaming… (enter queues your next message)
                </text>
              </Show>
            </box>
          </box>
        </box>

        {/* Sidebar */}
        <SidebarApx sessionID={sessionID()} />
      </box>
      <Toast />
    </box>
  )
}
