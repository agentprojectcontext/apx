import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createSimpleContext } from "./helper"
import { onCleanup } from "solid-js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, execSync } from "node:child_process"

const TOKEN_PATH = path.join(os.homedir(), ".apx", "daemon.token")

/** Current git branch for `dir`, or "" when not a repo. Cheap, best-effort. */
function gitBranch(dir: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim()
  } catch {
    return ""
  }
}

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
  | { type: "model_start"; sessionID: string; model?: string; iteration?: number }
  | { type: "assistant_text"; sessionID: string; text: string }
  | { type: "tool_start"; sessionID: string; id: string; name: string; args?: any }
  | { type: "tool_done"; sessionID: string; id: string; name: string; result?: string; ok?: boolean }
  | {
      type: "final"
      sessionID: string
      text: string
      usage?: { input_tokens: number; output_tokens: number }
      name?: string
    }
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

    // Live model override. Defaults to the launch arg; updated when the user
    // picks a model via /models (the Session view bridges local.model → here).
    // Sent as `body.model` so the daemon's super-agent uses it for the turn.
    let currentModel: string | undefined = props.model
    const setModel = (model: string | undefined) => {
      currentModel = model || undefined
    }
    const getModel = () => currentModel

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
      // Run on the `code` channel and hand the daemon our working directory so
      // the agent knows WHERE it is (CWD/project) — otherwise it falls back to
      // the generic API channel with no cwd and asks "which file? which project?".
      // maxIters gives room to chain read→edit→verify; the code.md prompt already
      // carries the "keep going until done" guidance. We deliberately do NOT send
      // completionContract here — on weaker models (e.g. gemini-flash) the hard
      // loop-until-finish contract causes runaway edit/rewrite loops.
      const body: Record<string, unknown> = {
        prompt,
        previousMessages,
        channel: "code",
        channelMeta: { cwd: props.directory ?? process.cwd() },
        maxIters: 40,
        maxTokens: 8192,
      }
      if (currentModel) body.model = currentModel
      const res = await fetch(`${props.url}/projects/${props.pid}/super-agent/chat/stream`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
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
      // The daemon may keep the HTTP connection open after the final event, so
      // we can't rely on stream-close to know the turn is done. Resolve as soon
      // as we see `final` or `error` — otherwise the caller's `await` hangs and
      // the next message queues forever.
      let finished = false
      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const ev = JSON.parse(line)
            // Real APX super-agent event names (see core/agent/run-agent.js):
            //   model_start { model, iteration }
            //   assistant_text { text, iteration }   ← narration between tools
            //   tool_start { tool, args, iteration }
            //   tool_result { trace: { tool, args, result }, iteration }
            //   final { result: { text, usage, name } }
            //   error { error }
            // `token`/`chunk` are kept for any future token-streaming backend.
            switch (ev.type) {
              case "token":
              case "chunk":
                emitter.emit("event", { type: "chunk", sessionID, chunk: ev.text ?? ev.chunk ?? "" })
                break
              case "model_start":
                emitter.emit("event", { type: "model_start", sessionID, model: ev.model, iteration: ev.iteration })
                break
              case "assistant_text":
                if (ev.text) emitter.emit("event", { type: "assistant_text", sessionID, text: ev.text })
                break
              case "tool_start":
                // run-agent.js emits { type:"tool_start", trace:{ id, tool, args } }
                emitter.emit("event", {
                  type: "tool_start",
                  sessionID,
                  id: String(ev.trace?.id ?? `${ev.trace?.tool ?? "tool"}-${ev.iteration ?? 0}`),
                  name: ev.trace?.tool ?? ev.tool ?? "tool",
                  args: ev.trace?.args ?? ev.args,
                })
                break
              case "tool_result":
                emitter.emit("event", {
                  type: "tool_done",
                  sessionID,
                  id: String(ev.trace?.id ?? ""),
                  name: ev.trace?.tool ?? "tool",
                  result: typeof ev.trace?.result === "string" ? ev.trace.result : JSON.stringify(ev.trace?.result ?? ""),
                  ok: !ev.trace?.error,
                })
                break
              case "final":
                emitter.emit("event", {
                  type: "final",
                  sessionID,
                  text: ev.result?.text ?? "",
                  usage: ev.result?.usage,
                  name: ev.result?.name,
                })
                finished = true
                break
              case "error":
                emitter.emit("event", { type: "error", sessionID, error: ev.error })
                finished = true
                break
            }
          } catch {
            // ignore parse errors for partial lines
          }
          if (finished) break
        }
      }
      // Stop reading and release the connection so the awaiting caller resumes.
      try {
        await reader.cancel()
      } catch {
        /* already closed */
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
      // "super-agent" is the *modality* of the APX default agent, not a
      // user-facing name (AGENTS.md rule 7). When no explicit agent is
      // passed, show "APX" in the sidebar.
      agent: props.agent ?? "APX",
      model: props.model ?? "claude-3-5-sonnet",
      // Working directory (the user's project root, passed via --cwd) and its
      // current git branch — shown in the sidebar / footer like OpenCode.
      directory: props.directory ?? process.cwd(),
      branch: gitBranch(props.directory ?? process.cwd()),
      event: emitter,
      client,
      streamChat,
      createSession,
      listSessions,
      runShell,
      setModel,
      getModel,
    }
  },
})
