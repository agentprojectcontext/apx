#!/usr/bin/env node
// APX ACP agent — serves the APX super-agent over the Agent Client Protocol
// (https://agentclientprotocol.com, JSON-RPC 2.0 over newline-delimited JSON
// on stdio), so ACP clients (Zed, JetBrains, marimo, …) can drive it.
// Canonical launch: `apx acp` (bin alias `apx-acp` mirrors `apx-mcp`).
//
// Like the mcp-server surface, this is a thin adapter over the daemon HTTP
// API: each `session/prompt` becomes a POST to the NDJSON stream endpoint
// `/projects/:pid/super-agent/chat/stream` and the stream events are mapped
// onto ACP `session/update` notifications:
//
//   assistant_text         → agent_message_chunk
//   tool_start             → tool_call        (status: in_progress)
//   tool_result            → tool_call_update (status: completed|failed)
//   confirmation_required  → session/request_permission round-trip, answered
//                            via POST /super-agent/confirm/:correlationId
//   final                  → session/prompt response { stopReason }
//
// IMPORTANT: stdout carries the protocol. Never log to stdout here — errors
// go to stderr and the unified file log only.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHANNELS } from "#core/constants/channels.js";
import { loggerFor } from "#core/logging.js";
import { APX_HOME } from "#core/config/index.js";
import { JsonRpcConnection, JsonRpcError, JSONRPC_ERROR_CODES } from "./jsonrpc.js";
import {
  createDaemonClient,
  createSession,
  extractPromptText,
  resolveProjectForCwd,
  summarizeToolResult,
  toolKindFor,
} from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Single major version integer per the ACP initialization spec.
export const ACP_PROTOCOL_VERSION = 1;

const log = loggerFor("acp");

function packageVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8")
    ).version;
  } catch {
    return "0.0.0";
  }
}

export class AcpAgentServer {
  /**
   * @param {{ input: import("node:stream").Readable,
   *           output: import("node:stream").Writable,
   *           daemon: { baseUrl: string, token?: string | (() => string) },
   *           ensureDaemon?: (() => Promise<void>) | null,
   *           version?: string }} opts
   * `daemon` and the streams are injectable so tests can run fully offline
   * against an in-process daemon API and PassThrough pipes.
   */
  constructor({ input, output, daemon, ensureDaemon = null, version = packageVersion() }) {
    this.version = version;
    this.sessions = new Map();
    this.clientCapabilities = {};
    this.client = createDaemonClient({
      baseUrl: daemon.baseUrl,
      token: daemon.token || "",
      ensureReady: ensureDaemon,
    });
    this.connection = new JsonRpcConnection({
      input,
      output,
      onError: (e) => this.#logError("connection error", e),
    });
  }

  start() {
    this.connection
      .method("initialize", (params) => this.#initialize(params))
      // No auth methods are advertised, so authenticate is a no-op accept —
      // daemon access control is the local bearer token, not an ACP concern.
      .method("authenticate", () => ({}))
      .method("session/new", (params) => this.#newSession(params))
      .method("session/prompt", (params) => this.#prompt(params))
      .method("session/cancel", (params) => this.#cancel(params));
    return this;
  }

  whenClosed() {
    return this.connection.whenClosed();
  }

  #logError(msg, err) {
    const detail = err?.message || String(err || "");
    try {
      log.error(`${msg}: ${detail}`);
    } catch {
      /* file log is best-effort */
    }
    process.stderr.write(`apx acp: ${msg}: ${detail}\n`);
  }

  #initialize(params) {
    const requested = Number(params?.protocolVersion);
    this.clientCapabilities = params?.clientCapabilities || {};
    return {
      // Same version when we support what the client asked for, otherwise the
      // latest we do support — the client decides whether to disconnect.
      protocolVersion:
        requested === ACP_PROTOCOL_VERSION ? requested : ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
      },
      agentInfo: { name: "apx", title: "APX Super-Agent", version: this.version },
      authMethods: [],
    };
  }

  async #newSession(params) {
    const cwd = params?.cwd;
    if (!cwd || typeof cwd !== "string" || !path.isAbsolute(cwd)) {
      throw new JsonRpcError(
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "cwd must be an absolute path"
      );
    }
    let project;
    try {
      project = await resolveProjectForCwd(this.client, cwd);
    } catch (e) {
      throw new JsonRpcError(JSONRPC_ERROR_CODES.INTERNAL_ERROR, e.message);
    }
    const sessionId = `sess_${randomUUID().replace(/-/g, "")}`;
    this.sessions.set(sessionId, createSession({ id: sessionId, project, cwd }));
    return { sessionId };
  }

  #session(params) {
    const session = this.sessions.get(params?.sessionId);
    if (!session) {
      throw new JsonRpcError(
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        `unknown sessionId: ${params?.sessionId}`
      );
    }
    return session;
  }

  async #prompt(params) {
    const session = this.#session(params);
    if (session.activeTurn) {
      throw new JsonRpcError(
        JSONRPC_ERROR_CODES.INVALID_REQUEST,
        "a prompt turn is already in progress for this session"
      );
    }
    const promptText = extractPromptText(params.prompt);
    if (!promptText) {
      throw new JsonRpcError(
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "prompt must include at least one text content block"
      );
    }

    const turn = {
      abort: new AbortController(),
      cancelled: false,
      lastToolCallId: null,
      messageSeq: 0,
      sentTexts: new Set(),
    };
    session.activeTurn = turn;
    try {
      const final = await this.client.streamPost(
        `/projects/${session.project.id}/super-agent/chat/stream`,
        {
          prompt: promptText,
          // ACP clients are coding surfaces (IDEs) — the `code` channel gives
          // them the coding system prompt + git/code tools, same as apx code.
          channel: CHANNELS.CODE,
          previousMessages: session.history,
        },
        (event) => this.#onDaemonEvent(session, turn, event),
        { signal: turn.abort.signal }
      );
      if (turn.cancelled) return { stopReason: "cancelled" };
      if (!final) {
        throw new JsonRpcError(
          JSONRPC_ERROR_CODES.INTERNAL_ERROR,
          "daemon stream ended without a final result"
        );
      }
      // In-process history feeds previousMessages on the next turn, so the
      // conversation keeps context without daemon-side session storage.
      session.history.push({ role: "user", content: promptText });
      if (final.text) session.history.push({ role: "assistant", content: final.text });
      return { stopReason: "end_turn" };
    } catch (e) {
      // Aborts surface as generic stream errors — per spec, cancellation MUST
      // resolve the prompt with the "cancelled" stop reason, never an error.
      if (turn.cancelled) return { stopReason: "cancelled" };
      if (e instanceof JsonRpcError) throw e;
      throw new JsonRpcError(JSONRPC_ERROR_CODES.INTERNAL_ERROR, e.message);
    } finally {
      session.activeTurn = null;
    }
  }

  // session/cancel is a notification — no response, just abort the in-flight
  // daemon stream; #prompt observes `cancelled` and resolves the turn.
  #cancel(params) {
    const session = this.sessions.get(params?.sessionId);
    const turn = session?.activeTurn;
    if (!turn) return;
    turn.cancelled = true;
    turn.abort.abort();
  }

  #notifyUpdate(session, update) {
    this.connection.notify("session/update", { sessionId: session.id, update });
  }

  #sendMessageChunk(session, turn, text) {
    const value = String(text || "");
    if (!value || turn.sentTexts.has(value)) return;
    turn.sentTexts.add(value);
    turn.messageSeq += 1;
    this.#notifyUpdate(session, {
      sessionUpdate: "agent_message_chunk",
      messageId: `msg_${session.seq}_${turn.messageSeq}`,
      content: { type: "text", text: value },
    });
  }

  async #onDaemonEvent(session, turn, event) {
    switch (event?.type) {
      case "assistant_text":
        return this.#sendMessageChunk(session, turn, event.text);
      // The loop only emits assistant_text for mid-turn progress; the closing
      // reply usually travels solely inside the final result, so surface it
      // as a chunk here (deduped against anything already streamed).
      case "final":
        return this.#sendMessageChunk(session, turn, event.result?.text);
      case "tool_start": {
        const trace = event.trace || {};
        const toolCallId = String(trace.id || `call_${randomUUID().slice(0, 8)}`);
        turn.lastToolCallId = toolCallId;
        this.#notifyUpdate(session, {
          sessionUpdate: "tool_call",
          toolCallId,
          title: String(trace.tool || "tool"),
          kind: toolKindFor(trace.tool),
          status: "in_progress",
          ...(trace.args && typeof trace.args === "object" ? { rawInput: trace.args } : {}),
        });
        return;
      }
      case "tool_result": {
        const trace = event.trace || {};
        const failed =
          trace.result && typeof trace.result === "object" && trace.result.error != null;
        this.#notifyUpdate(session, {
          sessionUpdate: "tool_call_update",
          toolCallId: String(trace.id || turn.lastToolCallId || "call_unknown"),
          status: failed ? "failed" : "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: summarizeToolResult(trace.result) },
            },
          ],
          ...(trace.result && typeof trace.result === "object"
            ? { rawOutput: trace.result }
            : {}),
        });
        return;
      }
      case "confirmation_required":
        return this.#requestPermission(session, turn, event);
      default:
        // model_start, model_routed, skill_inspector, … are APX-internal
        // progress events with no ACP counterpart.
        return;
    }
  }

  async #requestPermission(session, turn, event) {
    let confirmed = false;
    try {
      const res = await this.connection.request("session/request_permission", {
        sessionId: session.id,
        toolCall: {
          toolCallId: turn.lastToolCallId || String(event.correlationId),
          title: String(event.description || event.tool || "tool call"),
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      const outcome = res?.outcome;
      confirmed = outcome?.outcome === "selected" && outcome.optionId === "allow";
    } catch (e) {
      // Client gone or errored — never self-approve.
      this.#logError("permission request failed", e);
      confirmed = false;
    }
    try {
      await this.client.post(
        `/super-agent/confirm/${encodeURIComponent(event.correlationId)}`,
        { confirmed }
      );
    } catch (e) {
      // The pending-store entry times out on its own; log and move on.
      this.#logError("confirm resolution failed", e);
    }
  }
}

/** Run the ACP agent on the current process stdio against the local daemon. */
export async function startStdioAcpServer() {
  // Lazy import: the CLI http helper auto-starts the daemon; tests never
  // reach this path (they inject their own base URL).
  const { ensureDaemon } = await import("#interfaces/cli/http.js");
  const host = process.env.APX_HOST || "127.0.0.1";
  const port = parseInt(process.env.APX_PORT || "7430", 10);
  const tokenPath = path.join(APX_HOME, "daemon.token");
  const server = new AcpAgentServer({
    input: process.stdin,
    output: process.stdout,
    daemon: {
      baseUrl: `http://${host}:${port}`,
      // Re-read per request so a daemon restart with a rotated token mid-
      // session keeps working.
      token: () => {
        try {
          return fs.readFileSync(tokenPath, "utf8").trim();
        } catch {
          return "";
        }
      },
    },
    ensureDaemon: () => ensureDaemon({ silent: true }),
  });
  server.start();
  await server.whenClosed();
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startStdioAcpServer().catch((e) => {
    process.stderr.write(`apx acp: fatal: ${e?.message || e}\n`);
    process.exit(1);
  });
}
