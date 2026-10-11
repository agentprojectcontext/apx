// Codex in its own sessions: the owner's own `codex` (their ChatGPT login and config). APX tools reach it through a
// per-run MCP proxy (`apx mcp --run <token>`) that calls back into this core. See DECISIONS.md#d-007
import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import { worksInFolder } from "../domain/threads.ts";
import { harnessEnv } from "./env.ts";
import { effortPart, type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";

const READ_ONLY_NOTE =
  "[APX: this turn is read-only: outside content is in this session, or this agent asks before acting. Say so if a change is needed: the owner can make it, start a new chat, or give the agent total autonomy.]";

/** Whether Codex may edit and run commands in the folder this turn. See DECISIONS.md#d-057 */
export function codexWrites(io: Pick<TurnIO, "thread" | "agent" | "outside">): boolean {
  if (!worksInFolder(io.thread) || io.thread.write !== "auto") return false;
  const autonomy = io.agent.autonomy ?? "standard";
  if (autonomy === "total") return true;
  return autonomy !== "ask" && !io.outside();
}

export type McpCommand = { command: string; args: string[]; env: Record<string, string> };

export function codexHarness(opts: {
  codexPath: () => Promise<string>;
  cwd: (io: TurnIO) => string;
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
        const apx = { ...gate.command, default_tools_approval_mode: "approve" };
        const codex = new Codex({
          codexPathOverride: codexPath,
          // With approval "never" Codex refuses every MCP call unless the server's tools are pre-approved; APX's gate
          // asks the owner itself when a tool needs it.
          config: { mcp_servers: { apx } },
          env: harnessEnv(),
        });
        // Codex cannot ask mid-turn: in a code thread it writes only when the thread's policy is "auto", and then its
        // OS sandbox keeps commands and edits inside the folder (the UI says so when the policy is chosen). An agent
        // that asks first, or outside content in the session, keeps it reading unless the owner chose total autonomy.
        const writes = codexWrites(io);
        const threadOptions = {
          workingDirectory: opts.cwd(io),
          skipGitRepoCheck: true,
          sandboxMode: writes ? ("workspace-write" as const) : ("read-only" as const),
          approvalPolicy: "never" as const,
          ...(chosen ? { model: chosen } : {}),
          ...(effort ? { modelReasoningEffort: effort as ModelReasoningEffort } : {}),
        };
        const thread = io.sessionId
          ? codex.resumeThread(io.sessionId, threadOptions)
          : codex.startThread(threadOptions);
        const held = worksInFolder(io.thread) && io.thread.write === "auto" && !writes;
        const { events } = await thread.runStreamed(
          held ? `${READ_ONLY_NOTE}\n\n${io.input.content}` : io.input.content,
          {
            signal: io.signal,
          },
        );
        let text = "";
        let sessionId = io.sessionId;
        let usage: TurnOutcome["usage"];
        for await (const ev of events) {
          io.alive?.();
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
        return { text, model: `codex/${chosen ?? "default"}`, effort, sessionId, usage };
      } finally {
        gate.close();
      }
    },
  };
}
