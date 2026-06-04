/**
 * APX sync context.
 *
 * A lightweight replacement for opencode's sync-v2 store. Holds session
 * messages keyed by a local session id, updated from the APX daemon's NDJSON
 * stream via the SDK.
 *
 * Assistant turns are modelled as an ordered list of *parts* — narration text
 * and tool calls — so the session view can render them OpenCode-style
 * (text, → read, → glob, then the final markdown answer). Per-session
 * token/cost usage is tracked for the sidebar Context panel.
 *
 * APX super-agent event names (see core/agent/run-agent.js):
 *   model_start { model, iteration }
 *   assistant_text { text }              narration emitted between tool calls
 *   tool_start { tool, args }            → forwarded by sdk-apx as {name,args}
 *   tool_result { trace:{tool,result} }  → forwarded as tool_done {name,result}
 *   final { text, usage, name }          the complete final answer
 *   error { error }
 */
import { createStore, produce } from "solid-js/store"
import { createMemo } from "solid-js"
import { useSDK } from "./sdk-apx"
import { createSimpleContext } from "./helper"

export type ApxMessageRole = "user" | "assistant" | "shell" | "system"

/** Ordered fragments that make up an assistant turn. */
export type ApxPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; args?: any; result?: string; ok?: boolean; running?: boolean }

export interface ApxMessage {
  id: string
  role: ApxMessageRole
  text: string
  /** assistant: ordered parts (text / tool). */
  parts?: ApxPart[]
  streaming?: boolean
  error?: boolean
  /** user: queued but not yet sent. */
  queued?: boolean
  /** shell: the command being run */
  command?: string
  /** shell: process exit code (undefined while running) */
  exitCode?: number | null
  createdAt: number
}

export interface ApxUsage {
  input: number
  output: number
  cost: number
}

interface SessionState {
  messages: ApxMessage[]
  title?: string
  usage: ApxUsage
}

interface ApxSyncStore {
  sessions: Record<string, SessionState>
  currentSessionID: string | null
}

const newSession = (): SessionState => ({ messages: [], usage: { input: 0, output: 0, cost: 0 } })

export const { use: useApxSync, provider: ApxSyncProvider } = createSimpleContext({
  name: "ApxSync",
  init: () => {
    const sdk = useSDK()
    const [store, setStore] = createStore<ApxSyncStore>({
      sessions: {},
      currentSessionID: null,
    })

    const ensureSession = (sessionID: string) => {
      if (!store.sessions[sessionID]) setStore("sessions", sessionID, newSession())
    }

    // The assistant message currently being streamed for a session.
    let activeAssistant: { sessionID: string; id: string } | null = null

    const ensureAssistant = (sessionID: string): string => {
      if (activeAssistant && activeAssistant.sessionID === sessionID) return activeAssistant.id
      const id = crypto.randomUUID()
      activeAssistant = { sessionID, id }
      ensureSession(sessionID)
      setStore(
        "sessions",
        sessionID,
        "messages",
        produce((m: ApxMessage[]) => {
          m.push({ id, role: "assistant", text: "", parts: [], streaming: true, createdAt: Date.now() })
        }),
      )
      return id
    }

    const patchAssistant = (sessionID: string, id: string, fn: (msg: ApxMessage) => void) => {
      setStore(
        "sessions",
        sessionID,
        "messages",
        produce((m: ApxMessage[]) => {
          const msg = m.find((x) => x.id === id)
          if (msg) fn(msg)
        }),
      )
    }

    const pushUser = (sessionID: string, text: string, queued = false): string => {
      const id = crypto.randomUUID()
      ensureSession(sessionID)
      setStore(
        "sessions",
        sessionID,
        "messages",
        produce((m: ApxMessage[]) => {
          m.push({ id, role: "user", text, queued: queued || undefined, createdAt: Date.now() })
        }),
      )
      if (!store.sessions[sessionID]?.title && !queued) {
        setStore("sessions", sessionID, "title", text.slice(0, 60))
      }
      return id
    }

    const onEvent = (event: any) => {
      switch (event.type) {
        case "user":
          pushUser(event.sessionID, event.text)
          break

        case "model_start":
          ensureAssistant(event.sessionID)
          break

        case "assistant_text": {
          if (!event.text) break
          const id = ensureAssistant(event.sessionID)
          patchAssistant(event.sessionID, id, (msg) => {
            const parts = msg.parts ?? (msg.parts = [])
            // Each narration block is its own part; merge if the last part is
            // also text and we're still in the same burst.
            const last = parts[parts.length - 1]
            if (last && last.kind === "text") last.text += event.text
            else parts.push({ kind: "text", text: event.text })
            msg.text = event.text
          })
          break
        }

        case "tool_start": {
          const id = ensureAssistant(event.sessionID)
          patchAssistant(event.sessionID, id, (msg) => {
            const parts = msg.parts ?? (msg.parts = [])
            parts.push({ kind: "tool", id: event.id, name: event.name, args: event.args, running: true })
          })
          break
        }

        case "tool_done": {
          const id = ensureAssistant(event.sessionID)
          patchAssistant(event.sessionID, id, (msg) => {
            const parts = msg.parts ?? (msg.parts = [])
            // Match by trace id when present; otherwise the last still-running
            // tool with the same name.
            const tool = [...parts]
              .reverse()
              .find(
                (p) =>
                  p.kind === "tool" &&
                  (p as any).running &&
                  ((event.id && (p as any).id === event.id) || (p as any).name === event.name),
              ) as Extract<ApxPart, { kind: "tool" }> | undefined
            if (tool) {
              tool.running = false
              tool.result = event.result
              tool.ok = event.ok
            } else {
              parts.push({ kind: "tool", id: event.id, name: event.name, result: event.result, ok: event.ok })
            }
          })
          break
        }

        case "chunk": {
          const id = ensureAssistant(event.sessionID)
          patchAssistant(event.sessionID, id, (msg) => {
            msg.text += event.chunk
            const parts = msg.parts ?? (msg.parts = [])
            const last = parts[parts.length - 1]
            if (last && last.kind === "text") last.text += event.chunk
            else parts.push({ kind: "text", text: event.chunk })
          })
          break
        }

        case "final": {
          const sessionID = event.sessionID
          ensureSession(sessionID)
          if (activeAssistant && activeAssistant.sessionID === sessionID) {
            const id = activeAssistant.id
            patchAssistant(sessionID, id, (msg) => {
              msg.streaming = false
              const parts = msg.parts ?? (msg.parts = [])
              const finalText = (event.text ?? "").trim()
              const lastText = [...parts].reverse().find((p) => p.kind === "text") as
                | Extract<ApxPart, { kind: "text" }>
                | undefined
              if (finalText) {
                // Avoid duplicating: the last narration usually equals the final.
                if (!lastText || lastText.text.trim() !== finalText) {
                  parts.push({ kind: "text", text: event.text })
                }
                msg.text = event.text
              }
            })
            activeAssistant = null
          } else {
            setStore(
              "sessions",
              sessionID,
              "messages",
              produce((m: ApxMessage[]) => {
                m.push({
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text: event.text || "",
                  parts: event.text ? [{ kind: "text", text: event.text }] : [],
                  createdAt: Date.now(),
                })
              }),
            )
          }
          if (event.usage) {
            setStore(
              "sessions",
              sessionID,
              "usage",
              produce((u: ApxUsage) => {
                u.input += event.usage.input_tokens || 0
                u.output += event.usage.output_tokens || 0
                u.cost += event.usage.cost || 0
              }),
            )
          }
          break
        }

        case "error": {
          ensureSession(event.sessionID)
          if (activeAssistant && activeAssistant.sessionID === event.sessionID) activeAssistant = null
          setStore(
            "sessions",
            event.sessionID,
            "messages",
            produce((m: ApxMessage[]) => {
              m.push({
                id: crypto.randomUUID(),
                role: "assistant",
                text: event.error || "Unknown error",
                error: true,
                createdAt: Date.now(),
              })
            }),
          )
          break
        }

        // ── Shell events ────────────────────────────────────────────────
        case "shell.start":
          ensureSession(event.sessionID)
          setStore(
            "sessions",
            event.sessionID,
            "messages",
            produce((m: ApxMessage[]) => {
              m.push({
                id: event.shellID,
                role: "shell",
                text: "",
                command: event.command,
                streaming: true,
                createdAt: Date.now(),
              })
            }),
          )
          break
        case "shell.output":
          setStore(
            "sessions",
            event.sessionID,
            "messages",
            produce((m: ApxMessage[]) => {
              const msg = m.find((x) => x.id === event.shellID)
              if (msg) msg.text += event.chunk
            }),
          )
          break
        case "shell.done":
          setStore(
            "sessions",
            event.sessionID,
            "messages",
            produce((m: ApxMessage[]) => {
              const msg = m.find((x) => x.id === event.shellID)
              if (msg) {
                msg.streaming = false
                msg.exitCode = event.exitCode
              }
            }),
          )
          break
      }
    }

    sdk.event.on("event", onEvent)

    const sendMessage = async (text: string) => {
      const sessionID = store.currentSessionID ?? (await sdk.createSession())
      if (!store.currentSessionID) setStore("currentSessionID", sessionID)
      pushUser(sessionID, text)
      await sdk.streamChat(sessionID, text)
    }

    const runShell = async (command: string) => {
      const sessionID = store.currentSessionID ?? (await sdk.createSession())
      if (!store.currentSessionID) setStore("currentSessionID", sessionID)
      ensureSession(sessionID)
      await sdk.runShell(sessionID, command)
    }

    const messagesFor = (sessionID: string): ApxMessage[] => store.sessions[sessionID]?.messages ?? []
    const usageFor = (sessionID: string): ApxUsage =>
      store.sessions[sessionID]?.usage ?? { input: 0, output: 0, cost: 0 }
    const titleFor = (sessionID: string): string | undefined => store.sessions[sessionID]?.title

    const currentSession = createMemo(() => store.currentSessionID)

    /** Append a queued user bubble (greyed while a turn is in flight). */
    const queueMessage = (text: string): string => {
      const sessionID = store.currentSessionID ?? ""
      if (!sessionID) return ""
      return pushUser(sessionID, text, true)
    }

    const removeMessage = (sessionID: string, id: string) => {
      setStore(
        "sessions",
        sessionID,
        "messages",
        produce((m: ApxMessage[]) => {
          const idx = m.findIndex((x) => x.id === id)
          if (idx >= 0) m.splice(idx, 1)
        }),
      )
    }

    /** Promote a queued bubble to a real, sent turn. */
    const sendQueued = async (sessionID: string, id: string) => {
      const msg = store.sessions[sessionID]?.messages.find((x) => x.id === id)
      if (!msg) return
      setStore(
        "sessions",
        sessionID,
        "messages",
        produce((m: ApxMessage[]) => {
          const target = m.find((x) => x.id === id)
          if (target) target.queued = undefined
        }),
      )
      await sdk.streamChat(sessionID, msg.text)
    }

    return {
      session: {
        current: currentSession,
        messages: messagesFor,
        usage: usageFor,
        title: titleFor,
        // app.tsx (terminal title effect) expects a session-like object.
        get: (sessionID: string) =>
          store.sessions[sessionID] ? { id: sessionID, title: titleFor(sessionID) ?? "New session" } : undefined,
        setCurrent: (id: string) => setStore("currentSessionID", id),
        list: () => Object.keys(store.sessions).map((id) => ({ id, title: titleFor(id) ?? "New session" })),
        refresh: async () => {},
      },
      sendMessage,
      queueMessage,
      sendQueued,
      removeMessage,
      runShell,
    }
  },
})
