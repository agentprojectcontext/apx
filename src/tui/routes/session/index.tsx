/**
 * APX session chat view.
 *
 * A self-contained chat interface that streams messages through the APX daemon
 * using the APX sync context. The complex opencode session view is replaced with
 * a simple but functional chat layout.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useApxSync } from "@tui/context/sync-apx"
import { useToast, Toast } from "@tui/ui/toast"
import { useExit } from "@tui/context/exit"
import { usePromptRef } from "@tui/context/prompt"
import type { ApxMessage } from "@tui/context/sync-apx"

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

function AssistantBubble(props: { msg: ApxMessage }) {
  const { theme } = useTheme()
  const hasText = () => props.msg.text.length > 0
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <text color={theme.success} bold>
        {props.msg.streaming ? "Assistant ▸" : "Assistant"}
      </text>
      <Show when={hasText()} fallback={<text color={theme.textMuted}>…</text>}>
        <text color={props.msg.error ? theme.error : theme.text} wrap>
          {props.msg.text}
        </text>
      </Show>
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
      await sync.sendMessage(text)
    } catch (e) {
      toast.error(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setSending(false)
    }
  }

  return (
    <box flexDirection="column" flexGrow={1} width={dims().width} height={dims().height}>
      {/* Message list */}
      <scrollbox
        flexGrow={1}
        stickyScroll
        stickyStart="bottom"
        verticalScrollbarOptions={{ visible: true }}
      >
        <box flexDirection="column" width={dims().width}>
          <Show
            when={messages().length > 0}
            fallback={
              <box paddingLeft={2} paddingTop={2}>
                <text color={theme.textMuted} italic>
                  Type a message and press Enter to start chatting.
                </text>
              </box>
            }
          >
            <For each={messages()}>
              {(msg) => (
                <Show when={msg.role === "user"} fallback={<AssistantBubble msg={msg} />}>
                  <UserBubble msg={msg} />
                </Show>
              )}
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
            placeholder={sending() ? "Waiting for response…" : "Ask anything... (Enter to send)"}
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
        <box height={1} paddingLeft={2} paddingRight={2}>
          <Show when={sending()}>
            <text color={theme.textMuted} italic>
              Streaming…
            </text>
          </Show>
        </box>
      </box>
      <Toast />
    </box>
  )
}
