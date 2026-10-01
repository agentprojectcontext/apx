// Claude Code as a harness: the turn runs in the owner's own `claude` (their login, their machine) through the
// Agent SDK. APX keeps identity and tools: the system prompt is ours and every APX tool call comes back through
// `io.execute`. See DECISIONS.md#d-007
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";

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

// Claude Code's own web tools are useful to a secretary; its file and shell tools are not offered.
const CLAUDE_BUILTINS = ["WebSearch", "WebFetch"];

export function claudeHarness(opts: { claudePath: () => Promise<string>; cwd: string }): Harness {
  return {
    id: "claude",
    async run(io: TurnIO): Promise<TurnOutcome> {
      const claudePath = await opts.claudePath();
      const chosen = modelPart(io.models[0]);
      let toolCalls = 0;
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
              cwd: opts.cwd,
              systemPrompt: { type: "custom", prompt: io.system },
              tools: CLAUDE_BUILTINS,
              allowedTools: [...CLAUDE_BUILTINS, ...io.tools.map((s) => `mcp__apx__${s.function.name}`)],
              // Nothing outside the allowed list may run, and nothing waits for an approval prompt.
              permissionMode: "dontAsk",
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
        // but never after a tool ran, since a rerun would repeat its effect. See DECISIONS.md#d-007
        if (io.sessionId && !io.signal.aborted && toolCalls === 0) return attempt(undefined);
        throw err;
      }
    },
  };
}

/** The harness process gets the environment minus APX's own secrets. */
export function harnessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("APX_")) env[k] = v;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "apx/2";
  return env;
}
