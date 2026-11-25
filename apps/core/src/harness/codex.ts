// Codex in its own sessions: the owner's own `codex` (their ChatGPT login and config). APX tools reach it through a
// per-run MCP proxy (`apx mcp --run <token>`) that calls back into this core. See DECISIONS.md#d-007
import path from "node:path";
import type { PlanStep } from "@apx/protocol/task-plan";
import { Codex, type ModelReasoningEffort, type TodoListItem } from "@openai/codex-sdk";
import { worksInFolder } from "../domain/threads.ts";
import { isInside, real, samePath } from "../paths.ts";
import { codexImageDir, imagesIn } from "../services/codex-images.ts";
import type { Reach, Root } from "../tools/folders.ts";
import { decide, editsInFolder, modeOf, sessionGate } from "../tools/policy.ts";
import { enginePlan } from "./engine-plan.ts";
import { harnessEnv } from "./env.ts";
import { effortPart, type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";
import { linkedWorktreeWritableDirs } from "./worktree.ts";

const READ_ONLY_NOTE =
  "[APX: this turn is read-only: this agent works in manual or plan mode, or the thread does not let it write. Say so if a change is needed: the owner can make it, change the agent's mode or let the session write.]";

/**
 * Where Codex's sandbox reaches this turn, from the folder rule for the agent as it acts (index.ts): its folders,
 * how far its files reach, whether the turn works for the owner, and APX's home, which it never reads.
 */
export type CodexPlace = { home: string; roots: Root[]; reach: Reach; forOwner: boolean };

/**
 * Whether Codex may edit and run commands in the folder this turn, for the agent as it acts (TurnIO.agent): Codex never
 * asks, so a thread that asks before writing stays read-only, except in total, where nothing waits (DECISIONS.md#d-115).
 * Outside a code thread it writes where our own agents would in its mode (Auto, Accept edits, Total), never for a
 * fenced agent or a turn that does not work for the owner (DECISIONS.md#d-271).
 */
export function codexWrites(
  io: Pick<TurnIO, "thread" | "agent" | "outside">,
  place?: Pick<CodexPlace, "reach" | "forOwner">,
): boolean {
  if (io.thread.write === "read-only") return false;
  // The same rule as any agent's edit in its folder (its mode, its own rules and a delegated session's cap,
  // DECISIONS.md#d-126); a card it would wait on is a no.
  if (sessionGate(io.thread, editsInFolder(io.agent, io.outside()), true).kind !== "allow") return false;
  if (worksInFolder(io.thread)) return io.thread.write === "auto" || modeOf(io.agent) === "total";
  return place?.forOwner === true && place.reach !== "fenced";
}

/** Files only the owner changes, but in Total: as `guarded` and `namesApc` keep them for every agent. */
const GUARDED = [
  "AGENTS.md",
  ".apc",
  path.join(".claude", "settings.json"),
  path.join(".claude", "settings.local.json"),
];
/** Where agents keep git worktrees under `.apc`: code, not APC definitions. */
const CHECKOUTS = [path.join(".apc", "worktree"), path.join(".apc", "worktrees")];
const PROFILE = "apx_turn";
type Access = "none" | "read" | "write";
const RANK: Record<Access, number> = { none: 0, read: 1, write: 2 };

export type CodexSandbox = {
  /** The sandbox flag, only where APX's profile cannot hold (no place, or Windows): it overrides any profile. */
  thread: { sandboxMode?: "read-only" | "workspace-write"; additionalDirectories?: string[] };
  /** The same folders as a plain sandbox, for a Codex without permission profiles, then the profile's name. */
  config: Record<string, string | Record<string, string[]>>;
  /** The profile's folders, as written: a path's dots would break a dotted key. */
  overrides: string[];
};

/**
 * Codex's sandbox for a turn. With a place, a permission profile: everything readable but APX's home and the folders
 * closed to the agent, and writable only where it may write on its own (its folder, its project's and the owner's
 * other projects, its temp folders), with AGENTS.md, APC files and Claude's settings kept unless `guard` is off.
 * Codex picks the most specific path, so a folder inside APX's home it works in stays open. See DECISIONS.md#d-271
 */
export function codexSandbox(o: {
  cwd: string;
  writes: boolean;
  /** Git metadata a linked worktree needs written (worktree.ts). */
  git: string[];
  guard: boolean;
  place?: CodexPlace | undefined;
  platform?: NodeJS.Platform;
}): CodexSandbox {
  const mode = o.writes ? ("workspace-write" as const) : ("read-only" as const);
  if (!o.place || (o.platform ?? process.platform) === "win32")
    return {
      thread: { sandboxMode: mode, ...(o.writes && o.git.length ? { additionalDirectories: o.git } : {}) },
      config: {},
      overrides: [],
    };
  const apx = real(o.place.home);
  const paths = new Map<string, Access>();
  // The same path twice keeps the stricter access.
  const set = (dir: string, access: Access) => {
    const at = real(dir);
    const was = paths.get(at);
    if (!was || RANK[access] < RANK[was]) paths.set(at, access);
  };
  const open = (r: Root) => !r.off && !r.lent && !r.anywhere;
  const roots = o.place.roots;
  // The folder rule takes the first root holding a path, Codex the most specific: a writable root inside an earlier
  // read-only or closed one stays as the rule has it.
  const shadowed = (i: number) =>
    roots.slice(0, i).some((r) => !r.anywhere && !r.write && isInside(real(r.dir), real(roots[i]?.dir ?? "")));
  // A turn not for the owner (a code thread an outside app or a contact reaches) writes its folder and temp folders only.
  const writable = o.writes
    ? roots.filter(
        (r, i) => r.write && open(r) && (r.scratch || o.place?.forOwner) && !isInside(real(r.dir), apx) && !shadowed(i),
      )
    : [];
  set(apx, "none");
  // Its own `apx` command (apx-command.ts).
  set(path.join(apx, "bin"), "read");
  for (const r of o.place.roots)
    if (r.off && !r.anywhere) set(r.dir, "none");
    else if (open(r) && !r.write) set(r.dir, "read");
  set(o.cwd, o.writes ? "write" : "read");
  for (const dir of [...(o.writes ? o.git : []), ...writable.map((r) => r.dir)]) set(dir, "write");
  // Beside the folder it runs in, which its sandbox already opens; a folder also closed stays closed.
  const extra: string[] = [];
  for (const [at, access] of paths)
    if (access === "write" && !isInside(real(o.cwd), at) && !extra.some((e) => samePath(e, at))) extra.push(at);
  if (o.writes && o.guard)
    for (const dir of [o.cwd, ...writable.filter((r) => !r.scratch).map((r) => r.dir)]) {
      for (const f of GUARDED) set(path.join(dir, f), "read");
      for (const f of CHECKOUTS) set(path.join(dir, f), "write");
    }
  const table = [`":root" = "read"`, ...[...paths].map(([p, a]) => `${JSON.stringify(p)} = "${a}"`)];
  return {
    thread: {},
    config: {
      sandbox_mode: mode,
      ...(extra.length ? { sandbox_workspace_write: { writable_roots: extra } } : {}),
      default_permissions: PROFILE,
    },
    overrides: [`permissions.${PROFILE}.filesystem={${table.join(", ")}}`],
  };
}

/** Whether a Codex turn may change AGENTS.md, APC files and Claude's settings: what always asks waits, and it cannot. */
export const codexGuards = (io: Pick<TurnIO, "agent" | "outside">): boolean =>
  decide("always", "local", io.agent, io.outside(), true).kind !== "allow";

/** More than this in one turn is a batch the owner asked for in files, not in the chat. */
const MAX_IMAGES = 8;

/**
 * Codex's own plan as steps. It says only which are completed: the first open one is the one at work, until its list
 * completes with the turn.
 */
function codexSteps(items: TodoListItem["items"], turnOver: boolean): PlanStep[] {
  const at = turnOver ? -1 : items.findIndex((t) => !t.completed);
  return items.map((t, i) => ({ step: t.text, state: t.completed ? "done" : i === at ? "doing" : "pending" }));
}

export type McpCommand = { command: string; args: string[]; env: Record<string, string> };

export function codexHarness(opts: {
  codexPath: () => Promise<string>;
  cwd: (io: TurnIO) => string;
  /** Where its sandbox reaches this turn; without one it keeps to its folder and reads anywhere. */
  place?: (io: TurnIO) => CodexPlace;
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
        const env = harnessEnv(io.agent.id);
        // Codex cannot ask mid-turn: it writes only where our own agents would change files on their own in its mode
        // (a code thread's "auto" policy, or the owner's projects outside one), and its OS sandbox keeps commands and
        // edits there. An agent in manual or plan mode keeps it reading (DECISIONS.md#d-106, DECISIONS.md#d-271).
        const place = opts.place?.(io);
        const writes = codexWrites(io, place);
        const workingDirectory = opts.cwd(io);
        // Its own sandbox keeps .git read-only; in a linked worktree git writes outside the folder too.
        const git = writes ? await linkedWorktreeWritableDirs(workingDirectory) : [];
        const sandbox = codexSandbox({ cwd: workingDirectory, writes, git, guard: codexGuards(io), place });
        const codex = new Codex({
          codexPathOverride: codexPath,
          // With approval "never" Codex refuses every MCP call unless the server's tools are pre-approved; APX's gate
          // asks the owner itself when a tool needs it. Its plan tool is off unless asked for: the owner sees its
          // checklist through it (DECISIONS.md#d-199).
          config: { mcp_servers: { apx }, tools: { update_plan: { enabled: true } }, ...sandbox.config },
          ...(sandbox.overrides.length ? { configOverrides: sandbox.overrides } : {}),
          env,
        });
        const madeBefore = new Set(io.sessionId ? imagesIn(codexImageDir(env, io.sessionId)) : []);
        const threadOptions = {
          workingDirectory,
          skipGitRepoCheck: true,
          ...sandbox.thread,
          approvalPolicy: "never" as const,
          ...(chosen ? { model: chosen } : {}),
          ...(effort ? { modelReasoningEffort: effort as ModelReasoningEffort } : {}),
        };
        const thread = io.sessionId
          ? codex.resumeThread(io.sessionId, threadOptions)
          : codex.startThread(threadOptions);
        const held = !writes && (worksInFolder(io.thread) ? io.thread.write === "auto" : place !== undefined);
        const { events } = await thread.runStreamed(
          held ? `${READ_ONLY_NOTE}\n\n${io.input.content}` : io.input.content,
          {
            signal: io.signal,
          },
        );
        let text = "";
        let sessionId = io.sessionId;
        let sessionUsage: TurnOutcome["sessionUsage"];
        const plan = enginePlan(io);
        for await (const ev of events) {
          io.alive?.();
          if (ev.type === "thread.started") sessionId = ev.thread_id;
          // Its own plan is APX's plan: the checklist under the answer, and a task's plan in its work chat.
          else if (ev.type.startsWith("item.") && "item" in ev && ev.item.type === "todo_list")
            plan.update(codexSteps(ev.item.items, ev.type === "item.completed"));
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
        await plan.settled();
        if (sessionId && io.showImage) {
          // Codex reports no event for what its image_gen made: its thread's folder says.
          const dir = codexImageDir(env, sessionId);
          const made = imagesIn(dir).filter((f) => !madeBefore.has(f));
          for (const f of made.slice(0, MAX_IMAGES)) io.showImage(path.join(dir, f));
        }
        return { text, model: `codex/${chosen ?? "default"}`, effort, sessionId, sessionUsage };
      } finally {
        gate.close();
      }
    },
  };
}
