import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createSimpleContext } from "./helper"
import { onCleanup } from "solid-js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
  | { type: "chunk"; sessionID: string; chunk: string }
  | { type: "final"; sessionID: string; text: string; usage?: { input_tokens: number; output_tokens: number } }
  | { type: "error"; sessionID: string; error: string }

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
      const res = await fetch(`${props.url}/projects/${props.pid}/super-agent/chat/stream`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ prompt, model: props.model, previousMessages }),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) throw new Error(`stream error: ${res.status}`)
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

    async function createSession(): Promise<string> {
      const token = readToken()
      const res = await fetch(`${props.url}/projects/${props.pid}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(`createSession: ${res.status}`)
      const data = await res.json()
      return (data as any).id as string
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
        prompt: async (_opts: any) => {},
        shell: async (_opts: any) => {},
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
    }
  },
})
