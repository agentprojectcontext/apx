// Codex as a harness: the owner's own `codex` (their ChatGPT login). APX tools reach it through a per-run MCP
// proxy (`apx2 mcp --run <token>`) that calls back into this core. See DECISIONS.md#d-007
import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import { harnessEnv } from "./env.ts";
import { effortPart, type Harness, modelPart, type TurnIO, type TurnOutcome, withInstructions } from "./types.ts";

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
      const effort = effortPart(io.models[0]);
      const gate = opts.gate(io);
      try {
        const codex = new Codex({
          codexPathOverride: codexPath,
          // With approval "never" Codex refuses every MCP call unless the server's tools are pre-approved; APX's gate
          // asks the owner itself when a tool needs it.
          config: { mcp_servers: { apx: { ...gate.command, default_tools_approval_mode: "approve" } } },
          env: harnessEnv(),
        });
        // Codex cannot ask mid-turn: in a code thread it writes only when the thread's policy is "auto", and then its
        // OS sandbox keeps commands and edits inside the folder (the UI says so when the policy is chosen).
        const writes = io.thread.kind === "code" && io.thread.write === "auto";
        const threadOptions = {
          workingDirectory: io.thread.cwd ?? opts.cwd,
          skipGitRepoCheck: true,
          sandboxMode: writes ? ("workspace-write" as const) : ("read-only" as const),
          approvalPolicy: "never" as const,
          ...(chosen ? { model: chosen } : {}),
          ...(effort ? { modelReasoningEffort: effort as ModelReasoningEffort } : {}),
        };
        const thread = io.sessionId
          ? codex.resumeThread(io.sessionId, threadOptions)
          : codex.startThread(threadOptions);
        const input = withInstructions(io, Boolean(io.sessionId));
        const { events } = await thread.runStreamed(input, { signal: io.signal });
        let text = "";
        let sessionId = io.sessionId;
        let usage: TurnOutcome["usage"];
        for await (const ev of events) {
          if (ev.type === "thread.started") sessionId = ev.thread_id;
          // Codex's own commands, edits and searches: shown as cards and recorded as steps.
          else if ((ev.type === "item.started" || ev.type === "item.completed") && ev.item.type !== "agent_message") {
            const it = ev.item;
            const done = ev.type === "item.completed";
            if (it.type === "command_execution")
              io.observe({
                callId: it.id,
                title: `Ran ${it.command.slice(0, 120)}`,
                kind: "execute",
                status: !done ? "running" : it.exit_code === 0 ? "ok" : "error",
                ...(done ? { detail: it.aggregated_output.slice(-300) } : {}),
              });
            else if (it.type === "file_change")
              io.observe({
                callId: it.id,
                title: `Changed ${it.changes
                  .map((c) => c.path)
                  .join(", ")
                  .slice(0, 120)}`,
                kind: "edit",
                status: !done ? "running" : it.status === "completed" ? "ok" : "error",
              });
            else if (it.type === "web_search")
              io.observe({ callId: it.id, title: `Searched ${it.query.slice(0, 120)}`, kind: "fetch", status: "ok" });
          } else if ((ev.type === "item.updated" || ev.type === "item.completed") && ev.item.type === "agent_message") {
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
