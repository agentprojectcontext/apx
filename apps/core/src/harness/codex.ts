// Codex in its own sessions: the owner's own `codex` (their ChatGPT login and config). APX tools reach it through a
// per-run MCP proxy (`apx mcp --run <token>`) that calls back into this core. See DECISIONS.md#d-007
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import { worksInFolder } from "../domain/threads.ts";
import { harnessEnv } from "./env.ts";
import { effortPart, type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";
import { linkedWorktreeWritableDirs } from "./worktree.ts";

const READ_ONLY_NOTE =
  "[APX: this turn is read-only: outside content is in this session, or this agent asks before acting. Say so if a change is needed: the owner can make it, start a new chat, or let the agent accept edits.]";

/** Whether Codex may edit and run commands in the folder this turn. See DECISIONS.md#d-057 */
export function codexWrites(io: Pick<TurnIO, "thread" | "agent" | "outside">): boolean {
  if (!worksInFolder(io.thread) || io.thread.write !== "auto") return false;
  const autonomy = io.agent.autonomy ?? "standard";
  // Accepting edits is what Codex's workspace-write sandbox does: its folder, whatever the session read.
  if (autonomy === "total" || autonomy === "edits") return true;
  return autonomy !== "ask" && !io.outside();
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;
/** More than this in one turn is a batch the owner asked for in files, not in the chat. */
const MAX_IMAGES = 8;

/** Where Codex keeps the images its image_gen tool made in one of its threads (it reports no event for them). */
function imageDir(env: Record<string, string>, codexThread: string): string {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "generated_images", codexThread);
}

function imagesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => IMAGE_FILE.test(f));
  } catch {
    return [];
  }
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
        const env = harnessEnv();
        const codex = new Codex({
          codexPathOverride: codexPath,
          // With approval "never" Codex refuses every MCP call unless the server's tools are pre-approved; APX's gate
          // asks the owner itself when a tool needs it.
          config: { mcp_servers: { apx } },
          env,
        });
        const madeBefore = new Set(io.sessionId ? imagesIn(imageDir(env, io.sessionId)) : []);
        // Codex cannot ask mid-turn: in a code thread it writes only when the thread's policy is "auto", and then its
        // OS sandbox keeps commands and edits inside the folder (the UI says so when the policy is chosen). An agent
        // that asks first, or outside content in the session, keeps it reading unless the owner chose total autonomy.
        const writes = codexWrites(io);
        const workingDirectory = opts.cwd(io);
        // Its own sandbox keeps .git read-only; in a linked worktree git writes outside the folder too.
        const gitDirs = writes ? await linkedWorktreeWritableDirs(workingDirectory) : [];
        const threadOptions = {
          workingDirectory,
          skipGitRepoCheck: true,
          sandboxMode: writes ? ("workspace-write" as const) : ("read-only" as const),
          ...(gitDirs.length ? { additionalDirectories: gitDirs } : {}),
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
        let sessionUsage: TurnOutcome["sessionUsage"];
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
          } else if (ev.type === "turn.completed") {
            // The whole session's tokens so far, not this turn's; `input_tokens` already counts the cached ones.
            const u = ev.usage;
            sessionUsage = {
              input: u.input_tokens,
              output: u.output_tokens,
              ...(u.cached_input_tokens ? { cached: u.cached_input_tokens } : {}),
            };
          } else if (ev.type === "turn.failed") throw new Error(`codex: ${ev.error.message}`);
          else if (ev.type === "error") throw new Error(`codex: ${ev.message}`);
        }
        if (sessionId && io.showImage) {
          const dir = imageDir(env, sessionId);
          const made = imagesIn(dir).filter((f) => !madeBefore.has(f));
          const at = (f: string) => fs.statSync(path.join(dir, f)).mtimeMs;
          for (const f of made.sort((a, b) => at(a) - at(b)).slice(0, MAX_IMAGES)) io.showImage(path.join(dir, f));
        }
        return { text, model: `codex/${chosen ?? "default"}`, effort, sessionId, sessionUsage };
      } finally {
        gate.close();
      }
    },
  };
}
