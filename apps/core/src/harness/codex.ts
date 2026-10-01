// Codex as a harness: the owner's own `codex` (their ChatGPT login). APX tools reach it through a per-run MCP
// proxy (`apx2 mcp --run <token>`) that calls back into this core. See DECISIONS.md#d-007
import { Codex } from "@openai/codex-sdk";
import { harnessEnv } from "./claude.ts";
import { type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";

export type McpCommand = { command: string; args: string[]; env: Record<string, string> };

export function codexHarness(opts: {
  codexPath: () => Promise<string>;
  cwd: string;
  /** Opens a tool gate for this turn and returns the MCP command that reaches it; `close` ends it. */
  gate(io: TurnIO): { command: McpCommand; close(): void };
}): Harness {
  return {
    id: "codex",
    async run(io: TurnIO): Promise<TurnOutcome> {
      const codexPath = await opts.codexPath();
      const chosen = modelPart(io.models[0]);
      const gate = opts.gate(io);
      try {
        const codex = new Codex({
          codexPathOverride: codexPath,
          config: { mcp_servers: { apx: gate.command } },
          env: harnessEnv(),
        });
        // Codex cannot ask mid-turn: in a code thread it writes only when the thread's policy is "auto".
        const writes = io.thread.kind === "code" && io.thread.write === "auto";
        const threadOptions = {
          workingDirectory: io.thread.cwd ?? opts.cwd,
          skipGitRepoCheck: true,
          sandboxMode: writes ? ("workspace-write" as const) : ("read-only" as const),
          approvalPolicy: "never" as const,
          ...(chosen ? { model: chosen } : {}),
        };
        const thread = io.sessionId
          ? codex.resumeThread(io.sessionId, threadOptions)
          : codex.startThread(threadOptions);
        // The Codex SDK has no system-prompt option: a new thread gets our instructions in its first message.
        const input = io.sessionId
          ? io.input.content
          : `<apx_instructions>\n${io.system}\n</apx_instructions>\n\n${io.input.content}`;
        const { events } = await thread.runStreamed(input, { signal: io.signal });
        let text = "";
        let sessionId = io.sessionId;
        let usage: TurnOutcome["usage"];
        for await (const ev of events) {
          if (ev.type === "thread.started") sessionId = ev.thread_id;
          else if ((ev.type === "item.updated" || ev.type === "item.completed") && ev.item.type === "agent_message") {
            text = ev.item.text;
            io.onText(text);
          } else if (ev.type === "turn.completed")
            usage = { input: ev.usage.input_tokens, output: ev.usage.output_tokens };
          else if (ev.type === "turn.failed") throw new Error(`codex: ${ev.error.message}`);
          else if (ev.type === "error") throw new Error(`codex: ${ev.message}`);
        }
        return { text, model: `codex/${chosen ?? "default"}`, sessionId, usage };
      } finally {
        gate.close();
      }
    },
  };
}
