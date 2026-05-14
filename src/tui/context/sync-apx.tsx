import { createStore, produce, reconcile } from "solid-js/store"
import { batch, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk-apx"
import type { ApxEvent } from "./sdk-apx"

export type ApxSession = {
  id: string
  title: string
  updatedAt?: number
}

export type ApxMessage = {
  id: string
  sessionID: string
  role: "user" | "assistant" | "shell"
  text: string
  streaming?: boolean
  error?: boolean
  // Shell-specific
  shellID?: string
  command?: string
  cwd?: string
  exitCode?: number | null
}

export const { use: useApxSync, provider: ApxSyncProvider } = createSimpleContext({
  name: "ApxSync",
  init: () => {
    const sdk = useSDK()

    const [store, setStore] = createStore<{
      status: "loading" | "ready"
      sessions: ApxSession[]
      messages: Record<string, ApxMessage[]>
      currentSessionID: string | undefined
      previousMessages: Array<{ role: string; content: string }>
    }>({
      status: "loading",
      sessions: [],
      messages: {},
      currentSessionID: undefined,
      previousMessages: [],
    })

    // Listen to APX stream events
    sdk.event.on("event", (ev: ApxEvent) => {
      if (ev.type === "chunk") {
        const e = ev
        setStore(
          "messages",
          produce((draft) => {
            const msgs = (draft[e.sessionID] ??= [])
            const last = msgs[msgs.length - 1]
            if (last?.role === "assistant" && last.streaming) {
              last.text += e.chunk
            } else {
              msgs.push({
                id: `msg-${Date.now()}`,
                sessionID: e.sessionID,
                role: "assistant",
                text: e.chunk,
                streaming: true,
              })
            }
          }),
        )
      }

      if (ev.type === "final") {
        const e = ev
        setStore(
          "messages",
          produce((draft) => {
            const msgs = (draft[e.sessionID] ??= [])
            const last = msgs[msgs.length - 1]
            if (last?.role === "assistant") {
              last.text = e.text
              last.streaming = false
            }
          }),
        )
        setStore("previousMessages", (prev) => [...prev, { role: "assistant", content: e.text }])
      }

      if (ev.type === "shell.start") {
        const e = ev
        setStore(
          "messages",
          produce((draft) => {
            ;(draft[e.sessionID] ??= []).push({
              id: e.shellID,
              sessionID: e.sessionID,
              role: "shell",
              text: "",
              streaming: true,
              shellID: e.shellID,
              command: e.command,
              cwd: e.cwd,
            })
          }),
        )
      }

      if (ev.type === "shell.output") {
        const e = ev
        setStore(
          "messages",
          produce((draft) => {
            const msgs = draft[e.sessionID]
            if (!msgs) return
            const target = msgs.find((m) => m.role === "shell" && m.shellID === e.shellID)
            if (target) target.text += e.chunk
          }),
        )
      }

      if (ev.type === "shell.done") {
        const e = ev
        setStore(
          "messages",
          produce((draft) => {
            const msgs = draft[e.sessionID]
            if (!msgs) return
            const target = msgs.find((m) => m.role === "shell" && m.shellID === e.shellID)
            if (target) {
              target.streaming = false
              target.exitCode = e.exitCode
              if (e.signal) target.text += `\n[killed by signal ${e.signal}]`
            }
          }),
        )
      }

      if (ev.type === "error") {
        const e = ev
        setStore(
          "messages",
          produce((draft) => {
            const msgs = (draft[e.sessionID] ??= [])
            const last = msgs[msgs.length - 1]
            if (last?.role === "assistant" && last.streaming) {
              last.streaming = false
              last.error = true
            } else {
              msgs.push({
                id: `err-${Date.now()}`,
                sessionID: e.sessionID,
                role: "assistant",
                text: e.error,
                streaming: false,
                error: true,
              })
            }
          }),
        )
      }
    })

    async function loadSessions() {
      const list = await sdk.listSessions()
      setStore("sessions", reconcile(list))
    }

    async function ensureSession(): Promise<string> {
      if (store.currentSessionID) return store.currentSessionID
      const id = await sdk.createSession()
      setStore("currentSessionID", id)
      setStore(
        "sessions",
        produce((draft) => {
          draft.unshift({ id, title: "New session" })
        }),
      )
      return id
    }

    async function runShell(command: string, cwd?: string) {
      const sessionID = await ensureSession()
      await sdk.runShell(sessionID, command, cwd ?? process.cwd())
    }

    async function sendMessage(text: string) {
      const sessionID = await ensureSession()
      const userMsg: ApxMessage = {
        id: `user-${Date.now()}`,
        sessionID,
        role: "user",
        text,
      }
      batch(() => {
        setStore(
          "messages",
          produce((draft) => {
            ;(draft[sessionID] ??= []).push(userMsg)
          }),
        )
        setStore("previousMessages", (prev) => [...prev, { role: "user", content: text }])
      })
      await sdk.streamChat(sessionID, text, store.previousMessages.slice(-20))
    }

    onMount(() => {
      void loadSessions().finally(() => setStore("status", "ready"))
    })

    return {
      data: store,
      get status() {
        return store.status
      },
      get ready() {
        return store.status === "ready"
      },
      session: {
        get(sessionID: string) {
          return store.sessions.find((s) => s.id === sessionID)
        },
        list() {
          return store.sessions
        },
        current() {
          return store.currentSessionID
        },
        setCurrent(id: string) {
          setStore("currentSessionID", id)
        },
        messages(sessionID: string) {
          return store.messages[sessionID] ?? []
        },
        async refresh() {},
      },
      sendMessage,
      runShell,
      ensureSession,
    }
  },
})
