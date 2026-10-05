// Codex as a harness: the owner's own `codex` (their ChatGPT login). APX tools reach it through a per-run MCP
// proxy (`apx2 mcp --run <token>`) that calls back into this core. See DECISIONS.md#d-007
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import { worksInFolder } from "../domain/threads.ts";
import { harnessEnv } from "./env.ts";
import { effortPart, type Harness, modelPart, type TurnIO, type TurnOutcome, withInstructions } from "./types.ts";

export type McpCommand = { command: string; args: string[]; env: Record<string, string> };

/**
 * Codex's own features that act on their own (shell, browser, computer use, sub-agents, plugins…). `code_mode_host`
 * stays on: Codex reaches MCP tools, APX's included, through it.
 */
const OWN_FEATURES = [
  "apps",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugins",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_suggest",
  "workspace_dependencies",
  "worktrees",
];
/** What a coding turn keeps: running commands and editing, inside the sandbox the thread's policy picked. */
const CODING_FEATURES = ["shell_tool", "unified_exec"];

/** The owner's own MCP servers in Codex's config (names only: their settings and secrets are never read). */
export function codexServerNames(home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")): string[] {
  let text = "";
  try {
    text = fs.readFileSync(path.join(home, "config.toml"), "utf8");
  } catch {
    return [];
  }
  const names = [...text.matchAll(/^\s*\[mcp_servers\.("?)([A-Za-z0-9_-]+)\1\s*\]/gm)].map((m) => m[2] ?? "");
  return [...new Set(names.filter(Boolean))];
}

/**
 * An APX turn runs Codex as the model with APX's tools, not as the owner's Codex app: their MCP servers, plugins,
 * skills, AGENTS.md and Codex's own web search, browser and sub-agents stay off. A code thread keeps commands and
 * edits (its sandbox follows the thread's policy). An engine session (the owner talking to Codex itself) is left as is.
 */
type ConfigValue = string | number | boolean | ConfigValue[] | { [key: string]: ConfigValue };
type Config = { [key: string]: ConfigValue };

export function codexOverrides(o: { coding: boolean; servers: string[]; apx: Config }): Config {
  const off = Object.fromEntries([...OWN_FEATURES, ...(o.coding ? [] : CODING_FEATURES)].map((f) => [f, false]));
  return {
    features: off,
    web_search: "disabled",
    project_doc_max_bytes: 0,
    mcp_servers: {
      ...Object.fromEntries(o.servers.filter((n) => n !== "apx").map((n) => [n, { enabled: false }])),
      apx: o.apx,
    },
  };
}

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
        const apx = { ...gate.command, default_tools_approval_mode: "approve" };
        const codex = new Codex({
          codexPathOverride: codexPath,
          // With approval "never" Codex refuses every MCP call unless the server's tools are pre-approved; APX's gate
          // asks the owner itself when a tool needs it.
          config: io.direct
            ? { mcp_servers: { apx } }
            : codexOverrides({ coding: worksInFolder(io.thread), servers: codexServerNames(), apx }),
          env: harnessEnv(),
        });
        // Codex cannot ask mid-turn: in a code thread it writes only when the thread's policy is "auto", and then its
        // OS sandbox keeps commands and edits inside the folder (the UI says so when the policy is chosen).
        const writes = worksInFolder(io.thread) && io.thread.write === "auto";
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
