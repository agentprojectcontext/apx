// Claude Code as a harness: the turn runs in the owner's own `claude` (their login, their machine) through the
// Agent SDK. APX keeps identity and tools: the system prompt is ours and every APX tool call comes back through
// `io.execute`. See DECISIONS.md#d-007
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { childEnv } from "./env.ts";
import { type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";

/**
 * Our tool specs are JSON Schema derived from each tool's zod schema; the Agent SDK wants a zod raw shape. Rebuilt
 * from the same schema (arrays, enums, limits included): a looser copy made Claude send arguments our check refuses.
 * See HISTORY.md#claude-tool-schema
 */
export function zodShape(params: object): z.ZodRawShape {
  const s = z.fromJSONSchema(params as Parameters<typeof z.fromJSONSchema>[0]);
  return s instanceof z.ZodObject ? s.shape : {};
}

// Claude Code's own web tools are useful to a secretary; its file and shell tools only in code threads.
const CLAUDE_BUILTINS = ["WebSearch", "WebFetch"];
const CODE_READ = ["Read", "Glob", "Grep", "LS"];
const CODE_WRITE = ["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"];
/** Claude Code's tool names as the protocol's tool kinds, for our policy. */
const KIND: Record<string, string> = {
  Read: "read",
  Glob: "search",
  Grep: "search",
  LS: "read",
  WebSearch: "fetch",
  WebFetch: "fetch",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "execute",
};

export function claudeHarness(opts: { claudePath: () => Promise<string>; cwd: string }): Harness {
  return {
    id: "claude",
    async run(io: TurnIO): Promise<TurnOutcome> {
      const claudePath = await opts.claudePath();
      const chosen = modelPart(io.models[0]);
      const code = io.thread.kind === "code";
      let toolCalls = 0;
      let builtins = 0;
      let permissions = 0;
      const server = createSdkMcpServer({
        name: "apx",
        version: "0.1.0",
        tools: io.tools.map((spec) =>
          tool(spec.function.name, spec.function.description, zodShape(spec.function.parameters), async (args) => {
            toolCalls++;
            const r = await io.execute(
              `${io.run.id}-c${toolCalls}`,
              spec.function.name,
              args as Record<string, unknown>,
            );
            return { content: [{ type: "text" as const, text: r.text }], isError: !r.ok };
          }),
        ),
      });
      const attempt = async (resume: string | undefined): Promise<TurnOutcome> => {
        const ac = new AbortController();
        const onAbort = () => ac.abort();
        io.signal.addEventListener("abort", onAbort, { once: true });
        let text = "";
        let model = chosen ?? "default";
        let sessionId = resume;
        try {
          const q = query({
            prompt: io.input.content,
            options: {
              abortController: ac,
              pathToClaudeCodeExecutable: claudePath,
              cwd: io.thread.cwd ?? opts.cwd,
              systemPrompt: { type: "custom", prompt: io.system },
              tools: code ? [...CLAUDE_BUILTINS, ...CODE_READ, ...CODE_WRITE] : CLAUDE_BUILTINS,
              // Outside code threads only the web tools and ours run. In a code thread every built-in tool (reads
              // included: they may reach outside the folder) comes to our policy through canUseTool.
              allowedTools: [...(code ? [] : CLAUDE_BUILTINS), ...io.tools.map((s) => `mcp__apx__${s.function.name}`)],
              permissionMode: code ? "default" : "dontAsk",
              ...(code
                ? {
                    canUseTool: async (name: string, input: Record<string, unknown>) => {
                      const ok = await io.approve({
                        callId: `${io.run.id}-p${++permissions}`,
                        title:
                          `${name} ${String(input.file_path ?? input.path ?? input.command ?? input.url ?? input.query ?? "").slice(0, 200)}`.trim(),
                        kind: KIND[name] ?? "other",
                        detail: JSON.stringify(input, null, 1),
                        input: { ...input, ...(input.file_path ? { path: input.file_path } : {}) },
                      });
                      return ok
                        ? { behavior: "allow" as const, updatedInput: input }
                        : { behavior: "deny" as const, message: "The owner's policy does not allow this here." };
                    },
                  }
                : {}),
              // Isolation: the owner's CLAUDE.md, hooks, plugins, MCP servers and claude.ai connectors/skills are not
              // part of an APX agent. These settings apply to this invocation only; the owner's config is untouched.
              settingSources: [],
              strictMcpConfig: true,
              settings: { disableClaudeAiConnectors: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false },
              mcpServers: { apx: server },
              includePartialMessages: true,
              ...(resume ? { resume } : {}),
              ...(chosen ? { model: chosen } : {}),
              env: harnessEnv(),
            },
          });
          for await (const m of q) {
            if (m.type === "stream_event" && !m.parent_tool_use_id) {
              const ev = m.event;
              if (ev.type === "message_start") text = "";
              if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
                text += ev.delta.text;
                io.onText(text);
              }
            } else if (m.type === "assistant" && !m.parent_tool_use_id) {
              model = m.message.model || model;
              sessionId = m.session_id;
              // Its own tools are shown as cards and recorded as steps; web tools also tell the policy that outside
              // text is now in the turn.
              for (const b of m.message.content)
                if (b.type === "tool_use" && !b.name.startsWith("mcp__apx__")) {
                  builtins++;
                  const input = b.input as Record<string, unknown>;
                  const what = input.query ?? input.url ?? input.file_path ?? input.path ?? input.command ?? "";
                  io.observe({
                    callId: b.id,
                    title: `${b.name}: ${String(what).slice(0, 160)}`,
                    kind: KIND[b.name] ?? "other",
                    status: "ok",
                  });
                }
            } else if (m.type === "result") {
              sessionId = m.session_id;
              if (m.subtype !== "success") throw new Error(`claude: ${m.subtype}`);
              return {
                text: m.result || text,
                model: `claude/${model}`,
                sessionId,
                usage: { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0 },
              };
            }
          }
          return { text, model: `claude/${model}`, sessionId };
        } finally {
          io.signal.removeEventListener("abort", onAbort);
        }
      };
      try {
        return await attempt(io.sessionId);
      } catch (err) {
        // A stored session can disappear (cleared by the owner): start a fresh one instead of failing the turn,
        // but only for that, and never after any tool ran (ours or Claude's), since a rerun would repeat its effect.
        // See DECISIONS.md#d-007
        const gone = /session|conversation/i.test(err instanceof Error ? err.message : String(err));
        if (io.sessionId && gone && !io.signal.aborted && toolCalls === 0 && builtins === 0) return attempt(undefined);
        throw err;
      }
    },
  };
}

/** The harness process gets the environment minus APX's own secrets. */
export function harnessEnv(): Record<string, string> {
  return { ...childEnv(), CLAUDE_AGENT_SDK_CLIENT_APP: "apx/2" };
}
