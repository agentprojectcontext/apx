// External harnesses: the turn runs inside the user's own Claude Code or Codex (their login, their machine).
// APX keeps identity, memory and tools: the system prompt is ours and every APX tool call comes back through
// `runTool`, so tool cards, guards and limits are the same as with the native loop. See DECISIONS.md#d-007
import path from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import type { AgentRecord } from "../domain/store.ts";
import type { ToolSpec } from "./provider.ts";

export type ExternalTurn = {
  agent: AgentRecord;
  system: string;
  /** The user turn (already framed with the per-turn preamble). */
  input: string;
  tools: ToolSpec[];
  /** The harness's own conversation id for this thread, when there is one. */
  sessionId: string | undefined;
  signal: AbortSignal;
  onText(soFar: string): void;
  runTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
};

export type ExternalResult = {
  text: string;
  model: string;
  sessionId: string | undefined;
  usage?: { input: number; output: number };
};

/** Neutral working directory: harness sessions must not land in (or read) the user's projects. */
export function harnessCwd(home: string): string {
  return path.join(home, "work");
}

type JsonProp = { type?: string; description?: string };

/** Our tool specs are flat JSON Schema objects; the Agent SDK wants a zod raw shape. */
function zodShape(params: object): Record<string, z.ZodType> {
  const p = params as { properties?: Record<string, JsonProp>; required?: string[] };
  const required = new Set(p.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(p.properties ?? {})) {
    let t: z.ZodType =
      prop.type === "integer"
        ? z.number().int()
        : prop.type === "number"
          ? z.number()
          : prop.type === "boolean"
            ? z.boolean()
            : z.string();
    if (prop.description) t = t.describe(prop.description);
    shape[key] = required.has(key) ? t : t.optional();
  }
  return shape;
}

// Claude Code's own web tools are useful to a secretary; its file/shell tools are not offered.
const CLAUDE_BUILTINS = ["WebSearch", "WebFetch"];

export async function runClaude(t: ExternalTurn, opts: { claudePath: string; cwd: string }): Promise<ExternalResult> {
  let toolCalls = 0;
  const server = createSdkMcpServer({
    name: "apx",
    version: "0.1.0",
    tools: t.tools.map((spec) =>
      tool(spec.function.name, spec.function.description, zodShape(spec.function.parameters), async (args) => {
        toolCalls++;
        const r = await t.runTool(spec.function.name, args as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: r.text }], isError: !r.ok };
      }),
    ),
  });
  const attempt = async (resume: string | undefined): Promise<ExternalResult> => {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    t.signal.addEventListener("abort", onAbort, { once: true });
    let text = "";
    let model = t.agent.model ?? "claude";
    let sessionId = resume;
    try {
      const q = query({
        prompt: t.input,
        options: {
          abortController: ac,
          pathToClaudeCodeExecutable: opts.claudePath,
          cwd: opts.cwd,
          systemPrompt: { type: "custom", prompt: t.system },
          tools: CLAUDE_BUILTINS,
          allowedTools: [...CLAUDE_BUILTINS, ...t.tools.map((s) => `mcp__apx__${s.function.name}`)],
          // Nothing outside the allowed list may run, and nothing waits for an approval prompt.
          permissionMode: "dontAsk",
          // Isolation: the user's CLAUDE.md, hooks, plugins, MCP servers and claude.ai connectors/skills are not
          // part of an APX agent. These settings apply to this invocation only; the user's config is untouched.
          settingSources: [],
          strictMcpConfig: true,
          settings: { disableClaudeAiConnectors: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false },
          mcpServers: { apx: server },
          includePartialMessages: true,
          ...(resume ? { resume } : {}),
          ...(t.agent.model ? { model: t.agent.model } : {}),
          env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "apx/2" },
        },
      });
      for await (const m of q) {
        if (m.type === "stream_event" && !m.parent_tool_use_id) {
          const ev = m.event;
          if (ev.type === "message_start") text = "";
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            text += ev.delta.text;
            t.onText(text);
          }
        } else if (m.type === "assistant" && !m.parent_tool_use_id) {
          model = m.message.model || model;
          sessionId = m.session_id;
        } else if (m.type === "result") {
          sessionId = m.session_id;
          if (m.subtype !== "success") throw new Error(`claude: ${m.subtype}`);
          return {
            text: m.result || text,
            model,
            sessionId,
            usage: { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0 },
          };
        }
      }
      return { text, model, sessionId };
    } finally {
      t.signal.removeEventListener("abort", onAbort);
    }
  };
  try {
    return await attempt(t.sessionId);
  } catch (err) {
    // A stored session can disappear (cleared by the user): start a fresh one instead of failing the turn,
    // but never after a tool ran, since a rerun would repeat its effect. See DECISIONS.md#d-007
    if (t.sessionId && !t.signal.aborted && toolCalls === 0) return attempt(undefined);
    throw err;
  }
}

export async function runCodex(
  t: ExternalTurn,
  opts: {
    codexPath: string;
    cwd: string;
    mcpCommand: { command: string; args: string[]; env: Record<string, string> };
  },
): Promise<ExternalResult> {
  const codex = new Codex({
    codexPathOverride: opts.codexPath,
    config: { mcp_servers: { apx: opts.mcpCommand } },
  });
  const threadOptions = {
    workingDirectory: opts.cwd,
    skipGitRepoCheck: true,
    sandboxMode: "read-only" as const,
    approvalPolicy: "never" as const,
    ...(t.agent.model ? { model: t.agent.model } : {}),
  };
  const thread = t.sessionId ? codex.resumeThread(t.sessionId, threadOptions) : codex.startThread(threadOptions);
  // The Codex SDK has no system-prompt option: a new thread gets our instructions in its first message.
  const input = t.sessionId ? t.input : `<apx_instructions>\n${t.system}\n</apx_instructions>\n\n${t.input}`;
  const { events } = await thread.runStreamed(input, { signal: t.signal });
  let text = "";
  let sessionId = t.sessionId;
  let usage: ExternalResult["usage"];
  for await (const ev of events) {
    if (ev.type === "thread.started") sessionId = ev.thread_id;
    else if ((ev.type === "item.updated" || ev.type === "item.completed") && ev.item.type === "agent_message") {
      text = ev.item.text;
      t.onText(text);
    } else if (ev.type === "turn.completed") usage = { input: ev.usage.input_tokens, output: ev.usage.output_tokens };
    else if (ev.type === "turn.failed") throw new Error(`codex: ${ev.error.message}`);
    else if (ev.type === "error") throw new Error(`codex: ${ev.message}`);
  }
  return { text, model: "codex", sessionId, ...(usage ? { usage } : {}) };
}
