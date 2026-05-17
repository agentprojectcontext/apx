import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createSimpleContext } from "./helper"
import { onCleanup } from "solid-js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const TOKEN_PATH = path.join(os.homedir(), ".apx", "daemon.token")

function readToken(): string {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim()
  } catch {
    return ""
  }
}

export type ApxEvent =
  | { type: "session.created"; sessionID: string }
  | { type: "user"; sessionID: string; text: string }
  | { type: "chunk"; sessionID: string; chunk: string }
  | { type: "final"; sessionID: string; text: string; usage?: { input_tokens: number; output_tokens: number } }
  | { type: "error"; sessionID: string; error: string }
  | { type: "shell.start"; sessionID: string; shellID: string; command: string; cwd: string }
  | { type: "shell.output"; sessionID: string; shellID: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "shell.done"; sessionID: string; shellID: string; exitCode: number | null; signal: NodeJS.Signals | null }

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    pid: string
    agent?: string
    model?: string
    // Legacy compat props (unused but accepted to avoid prop errors)
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: unknown
  }) => {
    const abort = new AbortController()
    const emitter = createGlobalEmitter<{ event: ApxEvent }>()

    function headers(): Record<string, string> {
      const token = readToken()
      return {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      }
    }

    async function streamChat(
      sessionID: string,
      prompt: string,
      previousMessages: Array<{ role: string; content: string }> = [],
    ) {
      // Do NOT send `model` — the super-agent owns its model (configured at the
      // system level in ~/.apx/config.json). Overriding it from the TUI would
      // bypass that single source of truth. `props.model` is kept only for
      // display in the sidebar.
      const res = await fetch(`${props.url}/projects/${props.pid}/super-agent/chat/stream`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ prompt, previousMessages }),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        // Surface the daemon's actual error message (e.g. {"error":"project not found"})
        // instead of a bare status code.
        let detail = ""
        try {
          const body = await res.text()
          const parsed = JSON.parse(body)
          detail = parsed?.error ?? body
        } catch {
          /* non-JSON / empty body */
        }
        throw new Error(detail ? `${detail} (HTTP ${res.status})` : `stream error: ${res.status}`)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const ev = JSON.parse(line)
            if (ev.type === "chunk") emitter.emit("event", { type: "chunk", sessionID, chunk: ev.chunk })
            if (ev.type === "final")
              emitter.emit("event", {
                type: "final",
                sessionID,
                text: ev.result?.text ?? "",
                usage: ev.result?.usage,
              })
            if (ev.type === "error") emitter.emit("event", { type: "error", sessionID, error: ev.error })
          } catch {
            // ignore parse errors for partial lines
          }
        }
      }
    }

    // The APX daemon has no generic "create session" route — a chat turn is
    // streamed directly through /super-agent/chat/stream. The TUI still needs a
    // stable session id to group messages, so we mint one locally.
    async function createSession(): Promise<string> {
      return `apx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }

    function runShell(sessionID: string, command: string, cwd: string = process.cwd()): Promise<{ shellID: string; exitCode: number | null }> {
      const shellID = `sh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      emitter.emit("event", { type: "shell.start", sessionID, shellID, command, cwd })
      return new Promise((resolve) => {
        const child = spawn(command, { shell: true, cwd, env: process.env })
        child.stdout?.on("data", (buf) => {
          emitter.emit("event", { type: "shell.output", sessionID, shellID, stream: "stdout", chunk: buf.toString() })
        })
        child.stderr?.on("data", (buf) => {
          emitter.emit("event", { type: "shell.output", sessionID, shellID, stream: "stderr", chunk: buf.toString() })
        })
        child.on("error", (err) => {
          emitter.emit("event", { type: "shell.output", sessionID, shellID, stream: "stderr", chunk: `[spawn error] ${err.message}\n` })
        })
        child.on("close", (code, signal) => {
          emitter.emit("event", { type: "shell.done", sessionID, shellID, exitCode: code, signal })
          resolve({ shellID, exitCode: code })
        })
      })
    }

    async function listSessions(): Promise<Array<{ id: string; title: string; updatedAt?: number }>> {
      try {
        const token = readToken()
        const res = await fetch(`${props.url}/projects/${props.pid}/sessions`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: abort.signal,
        })
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? data : []
      } catch {
        return []
      }
    }

    onCleanup(() => abort.abort())

    // Recursive Proxy: any sdk.client.X.Y.Z() call returns { data: [] } instead of crashing.
    function makeProxy(overrides: Record<string, any> = {}): any {
      const stub = async () => ({ data: [] })
      return new Proxy(stub, {
        get(_target, prop: string) {
          if (prop in overrides) return overrides[prop]
          return makeProxy()
        },
        apply(_target, _this, args) {
          // Check if any override matches this call pattern
          return Promise.resolve({ data: [] })
        },
      })
    }

    const client = makeProxy({
      session: makeProxy({
        createSession,
        listSessions,
        streamChat,
        create: async (_opts: any) => ({ data: { id: await createSession() } }),
        list: async (_opts: any) => ({ data: await listSessions() }),
        get: async (_opts: any) => ({ data: undefined }),
        delete: async (_opts: any) => ({ data: undefined }),
        fork: async (_opts: any) => ({ data: undefined, error: new Error("not supported") }),
        abort: async (_opts: any) => {},
        // Called by the opencode home prompt on submit. Extract the text from
        // the message parts, surface it as a user bubble, then stream the reply.
        prompt: async (opts: any) => {
          const sid: string = opts?.sessionID || (await createSession())
          const text = ((opts?.parts ?? []) as any[])
            .filter((p) => p && p.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("\n")
            .trim()
          if (!text) return { data: undefined }
          emitter.emit("event", { type: "user", sessionID: sid, text })
          void streamChat(sid, text).catch((err) => {
            emitter.emit("event", {
              type: "error",
              sessionID: sid,
              error: err instanceof Error ? err.message : String(err),
            })
          })
          return { data: { id: sid } }
        },
        shell: async (opts: { sessionID?: string; command?: string; cwd?: string }) => {
          if (!opts?.command) return { data: undefined }
          const sid = opts.sessionID || (await createSession())
          const r = await runShell(sid, opts.command, opts.cwd)
          return { data: r }
        },
        command: async (_opts: any) => {},
        refresh: async () => {},
        update: async (_opts: any) => ({ data: undefined }),
        messages: async (_opts: any) => ({ data: [] }),
        todo: async (_opts: any) => ({ data: [] }),
        diff: async (_opts: any) => ({ data: [] }),
        status: async (_opts: any) => ({ data: {} }),
      }),
      path: makeProxy({
        get: async (_opts?: any) => ({
          data: { home: "", state: "", config: "", worktree: "", directory: process.cwd() },
        }),
      }),
      project: makeProxy({
        current: async (_opts?: any) => ({ data: { id: props.pid } }),
      }),
      global: makeProxy({
        upgrade: async (_opts: any) => ({ data: undefined, error: new Error("not supported") }),
      }),
    })

    return {
      url: props.url,
      pid: props.pid,
      agent: props.agent ?? "super-agent",
      model: props.model ?? "claude-3-5-sonnet",
      // Legacy opencode compat
      directory: props.directory ?? process.cwd(),
      event: emitter,
      client,
      streamChat,
      createSession,
      listSessions,
      runShell,
    }
  },
})
