/**
 * APX session chat view.
 *
 * A self-contained chat interface that streams messages through the APX daemon
 * using the APX sync context. The complex opencode session view is replaced with
 * a simple but functional chat layout, plus an APX-tailored sidebar.
 */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useApxSync } from "@tui/context/sync-apx"
import { useToast, Toast } from "@tui/ui/toast"
import { useExit } from "@tui/context/exit"
import { usePromptRef } from "@tui/context/prompt"
import type { ApxMessage } from "@tui/context/sync-apx"
import { SidebarApx } from "./sidebar-apx"

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

function UserBubble(props: { msg: ApxMessage }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <text color={theme.primary} bold>
        You
      </text>
      <text color={theme.text} wrap>
        {props.msg.text}
      </text>
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
      <Show when={parsed().hint}>
        {(hint) => (
          <text color={theme.textMuted} wrap>
            {hint()}
          </text>
        )}
      </Show>
      <Show when={parsed().trace}>
        {(trace) => <text color={theme.textMuted}>trace: {trace()}</text>}
      </Show>
    </box>
  )
}

function AssistantBubble(props: { msg: ApxMessage }) {
  const { theme, syntax } = useTheme()
  const hasText = () => props.msg.text.trim().length > 0
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <text color={theme.success} bold>
        {props.msg.streaming ? "Assistant ▸" : "Assistant"}
      </text>
      <Show when={hasText()} fallback={<text color={theme.textMuted}>…</text>}>
        <box flexShrink={0}>
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={props.msg.streaming ?? false}
            syntaxStyle={syntax()}
            content={props.msg.text.trim()}
            conceal={true}
            fg={theme.text}
          />
        </box>
      </Show>
    </box>
  )
}

function ShellBubble(props: { msg: ApxMessage }) {
  const { theme } = useTheme()
  const header = () => {
    const code = props.msg.exitCode
    const status = props.msg.streaming
      ? "running"
      : code === 0
        ? "exit 0"
        : code == null
          ? "ended"
          : `exit ${code}`
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
  const toast = useToast()
  const exit = useExit()
  const promptRef = usePromptRef()
  const [sending, setSending] = createSignal(false)
  let inputEl: TextareaRenderable | undefined

  const sessionID = createMemo(() => {
    if (route.data.type === "session") return route.data.sessionID
    return sync.session.current() ?? ""
  })

  const messages = createMemo(() => sync.session.messages(sessionID()))

  onCleanup(() => {
    promptRef.set(undefined)
  })

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
    if (!text || sending()) return

    // Check for exit commands
    if (text === "exit" || text === "quit" || text === ":q") {
      void exit()
      return
    }

    inputEl.clear()
    setSending(true)
    try {
      if (text.startsWith("!") && text.length > 1) {
        await sync.runShell(text.slice(1).trim())
      } else {
        await sync.sendMessage(text)
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
          {/* Message list */}
          <scrollbox
            flexGrow={1}
            stickyScroll
            stickyStart="bottom"
            verticalScrollbarOptions={{ visible: true }}
          >
            <box flexDirection="column">
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
                    if (msg.role === "user") return <UserBubble msg={msg} />
                    if (msg.role === "shell") return <ShellBubble msg={msg} />
                    if (msg.error) return <ErrorBubble msg={msg} />
                    return <AssistantBubble msg={msg} />
                  }}
                </For>
              </Show>
              <box height={1} />
            </box>
          </scrollbox>

          {/* Input area */}
          <box
            flexShrink={0}
            flexDirection="column"
            borderTop={1}
            borderColor={theme.border}
            backgroundColor={theme.backgroundElement}
          >
            <box paddingLeft={2} paddingRight={2} paddingTop={1}>
              <textarea
                ref={(r: TextareaRenderable) => {
                  inputEl = r
                  promptRef.set(makeRef(r))
                }}
                placeholder={sending() ? "Waiting for response…" : "Ask anything... (prefix ! to run shell, e.g. !ls)"}
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
              <Show when={sending()} fallback={<text color={theme.textMuted}>enter send · ! shell · exit quit</text>}>
                <text color={theme.textMuted} italic>
                  Streaming…
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
