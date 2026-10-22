// Agents that speak the Agent Client Protocol, and how to start a session with one. Which CLIs exist and how they
// are invoked is data (the owner can add more in settings); nothing here picks a model.
import { spawn } from "node:child_process";
import type { Store } from "../../domain/store.ts";
import { stopTree } from "../../processes.ts";
import { childEnv } from "../env.ts";
import { connect, type RequestHandler, type Rpc, RpcError } from "./rpc.ts";

export type AcpAgent = {
  /** The engine id in model refs ("opencode/<model>"). */
  id: string;
  label: string;
  command: string;
  args: string[];
  /**
   * The command that signs the CLI in, for the error a session that needs it ends with. APX never signs it in itself:
   * its auth methods open the owner's browser, from turns and model listings nobody is watching.
   */
  login?: string;
  /**
   * What puts the CLI in "ask before acting" mode, so its edits and commands come to our policy as permission
   * requests. A CLI that acts without asking would bypass it.
   */
  env?: Record<string, string>;
};

/** ACP CLIs APX knows how to start. An owner adds others with the `acp_agents` setting. */
export const KNOWN_ACP_AGENTS: AcpAgent[] = [
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    args: ["acp"],
    env: {
      OPENCODE_PERMISSION: JSON.stringify({ edit: "ask", bash: "ask", webfetch: "ask", external_directory: "ask" }),
    },
  },
  { id: "qwen", label: "Qwen Code", command: "qwen", args: ["--acp", "--approval-mode", "default"] },
  { id: "cursor", label: "Cursor", command: "cursor-agent", args: ["acp"], login: "cursor-agent login" },
  { id: "gemini-cli", label: "Gemini CLI", command: "gemini", args: ["--acp"] },
  // From the ACP registry (agentclientprotocol.com/registry): each shows up once its CLI is installed.
  { id: "copilot", label: "GitHub Copilot", command: "copilot", args: ["--acp"] },
  { id: "goose", label: "goose", command: "goose", args: ["acp"] },
  { id: "kimi", label: "Kimi CLI", command: "kimi", args: ["acp"] },
  { id: "auggie", label: "Auggie", command: "auggie", args: ["--acp"] },
  { id: "droid", label: "Factory Droid", command: "droid", args: ["exec", "--output-format", "acp-daemon"] },
  { id: "vibe", label: "Mistral Vibe", command: "vibe-acp", args: [] },
  { id: "qoder", label: "Qoder", command: "qodercli", args: ["--acp"] },
  { id: "grok", label: "Grok", command: "grok", args: ["agent", "stdio"] },
  { id: "devin", label: "Devin", command: "devin", args: ["acp"] },
  { id: "amp", label: "Amp", command: "amp-acp", args: [] },
  { id: "kilo", label: "Kilo", command: "kilo", args: ["acp"] },
  { id: "cline", label: "Cline", command: "cline", args: ["--acp"] },
  { id: "codebuddy", label: "CodeBuddy", command: "codebuddy", args: ["--acp"] },
];

/** Known agents plus the owner's own (`acp_agents` setting: [{id, label, command, args, login?}]). */
export function acpAgents(store: Store): AcpAgent[] {
  const byId = new Map(KNOWN_ACP_AGENTS.map((a) => [a.id, a]));
  for (const { label, login, env, ...a } of store.settings.read("acp_agents"))
    byId.set(a.id, { ...a, label: label || a.id, ...(login ? { login } : {}), ...(env ? { env } : {}) });
  return [...byId.values()];
}

/** The engine id of an ACP agent in model refs and settings. */
export const acpEngine = (a: AcpAgent) => `acp:${a.id}`;

const INIT_MS = 30_000;
const SESSION_MS = 60_000;

/** A model the agent offers, from either form of session config the protocol has had. */
export type AcpModel = { id: string; name: string };

export type AcpSession = {
  rpc: Rpc;
  sessionId: string;
  models: AcpModel[];
  currentModel: string | undefined;
  /** Picks a model by id; true when the agent accepted it. */
  setModel(id: string): Promise<boolean>;
  close(): void;
};

type NewSessionResult = {
  sessionId?: string;
  configOptions?: Array<{
    id: string;
    category?: string;
    currentValue?: string;
    options?: Array<{ value: string; name: string }>;
  }>;
  models?: { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string }> };
};

function modelsOf(r: NewSessionResult): { models: AcpModel[]; current: string | undefined; configId?: string } {
  const opt = r.configOptions?.find((o) => o.category === "model" || o.id === "model");
  if (opt?.options)
    return {
      models: opt.options.map((o) => ({ id: o.value, name: o.name })),
      current: opt.currentValue,
      configId: opt.id,
    };
  return {
    models: (r.models?.availableModels ?? []).map((m) => ({ id: m.modelId, name: m.name })),
    current: r.models?.currentModelId,
  };
}

/**
 * Starts the agent, says hello and opens (or loads) a session in `cwd`. Updates and the agent's requests go to the
 * given handlers from the start, so nothing the agent says during setup is lost.
 */
export async function openSession(
  agent: AcpAgent,
  o: {
    binary: string;
    cwd: string;
    /** The APX agent it runs for: its commands carry it as APX_AGENT, as ours do. */
    apxAgent?: string | undefined;
    mcpServers?: Array<{ name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }>;
    resume?: string | undefined;
    /** Stops the setup too: a canceled turn does not wait for the agent to start. */
    signal?: AbortSignal | undefined;
    onUpdate?(update: Record<string, unknown>): void;
    onRequest?: RequestHandler;
  },
): Promise<AcpSession> {
  const child = spawn(o.binary, agent.args, {
    cwd: o.cwd,
    env: { ...childEnv(), ...agent.env, ...(o.apxAgent ? { APX_AGENT: o.apxAgent } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
    // Its own process group: closing it also stops what it started (the MCP proxy, its shells). Not on Windows,
    // where that opens a console window; taskkill reaches the tree there.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  child.stderr.resume();
  const rpc = connect(child, {
    request: (method, params) =>
      o.onRequest ? o.onRequest(method, params) : Promise.reject(new RpcError(-32601, `${method} not supported`)),
    notification: (method, params) => {
      if (method === "session/update") o.onUpdate?.((params as { update: Record<string, unknown> }).update);
    },
  });
  const alive = () => child.exitCode === null && child.signalCode === null;
  const close = () => {
    if (!alive() || !child.pid) return;
    stopTree(child.pid, { alive });
  };
  const stop = () => close();
  o.signal?.addEventListener("abort", stop, { once: true });
  if (o.signal?.aborted) close();
  try {
    const init = await rpc.request<{ agentCapabilities?: { loadSession?: boolean } }>(
      "initialize",
      // The agent works with its own files and terminal; what it wants to change comes to us as permissions.
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
      INIT_MS,
    );
    const params = { cwd: o.cwd, mcpServers: o.mcpServers ?? [] };
    let r: NewSessionResult;
    const open = async (): Promise<NewSessionResult> => {
      if (o.resume && init.agentCapabilities?.loadSession) {
        try {
          const res = await rpc.request<NewSessionResult>(
            "session/load",
            { ...params, sessionId: o.resume },
            SESSION_MS,
          );
          return { ...res, sessionId: o.resume };
        } catch {
          // A session the agent no longer has: a new one.
        }
      }
      return rpc.request<NewSessionResult>("session/new", params, SESSION_MS);
    };
    try {
      r = await open();
    } catch (err) {
      if (!(err instanceof RpcError && /auth/i.test(err.message))) throw err;
      throw new Error(
        `${agent.label} is not signed in: ${agent.login ? `run ${agent.login}` : "sign in with its own CLI"} in a terminal, then try again`,
      );
    }
    if (!r.sessionId) throw new Error(`${agent.label} opened no session`);
    if (o.signal?.aborted) throw o.signal.reason ?? new Error("canceled");
    const sessionId = r.sessionId;
    const m = modelsOf(r);
    return {
      rpc,
      sessionId,
      models: m.models,
      currentModel: m.current,
      async setModel(id) {
        try {
          if (m.configId)
            await rpc.request("session/set_config_option", { sessionId, configId: m.configId, value: id }, SESSION_MS);
          else await rpc.request("session/set_model", { sessionId, modelId: id }, SESSION_MS);
          return true;
        } catch {
          return false;
        }
      },
      close() {
        o.signal?.removeEventListener("abort", stop);
        close();
      },
    };
  } catch (err) {
    o.signal?.removeEventListener("abort", stop);
    close();
    throw err;
  }
}
