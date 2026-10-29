// Code, SQL and command steps of a graph run (DECISIONS.md#d-170). Each runs in a process of its own with a deadline
// and capped output. Code and reads change nothing: after a restart they start over. A command or a write is a side
// effect: it commits `dispatched` right before it starts, and anything after that without a clear end is left
// uncertain for the owner, never run again. Values from the payload reach them only as data: JSON, bound SQL
// parameters, environment variables and standard input.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FlowBinding, FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import type { FlowGraphRun, FlowStepKey } from "./domain/flow-graph-runs.ts";
import {
  boundedFlowValue,
  type FlowNodeSnapshot,
  flowVarIndex,
  resolveFlowInput,
} from "./domain/flow-graph-semantics.ts";
import { FLOW_ENV_REFUSED, flowDatabaseProblem } from "./domain/flow-graph-validate.ts";
import { flowSecretVars, secretTemplate } from "./domain/flow-secret-vars.ts";
import { flowSqlShape, SQL_READS, SQL_WRITES } from "./domain/flow-sql.ts";
import { type FlowApx, parseFlowTemplate, renderFlowTemplate } from "./domain/flow-template.ts";
import type { Store } from "./domain/store.ts";
import type { RunTimers } from "./engine/engine.ts";
import { runStep } from "./engine/pipeline.ts";
import { SECRET_REF } from "./flow-outward.ts";
import { flowApx, secretScrubber } from "./flow-outward-steps.ts";
import { commandEnv } from "./harness/env.ts";
import { nodeChildEnv } from "./node-runtime.ts";
import { isInside, real, realpath, tildeHome } from "./paths.ts";
import { workDir } from "./tools/folders.ts";

type Js = Extract<FlowNode, { kind: "js" }>;
type Sql = Extract<FlowNode, { kind: "sql" }>;
type Cmd = Extract<FlowNode, { kind: "cmd" }>;

/** Commands and database writes a Flow may make in an hour; the next one fails, not run. */
export const FLOW_COMMANDS_PER_HOUR = 60;
export const FLOW_WRITES_PER_HOUR = 120;
/** Most of a code step's answer read, and of a query's rows. */
const CODE_OUT = 64 * 1024;
const SQL_OUT = 256 * 1024;
const ROW_BYTES = 24 * 1024;
/** Most a command's input or a code step's input may be. */
const INPUT_LIMIT = 32 * 1024;
const HEAP_MB = 64;
const JS_RUNNER = path.join(import.meta.dirname, "flow-js-runner.mjs");
const SQL_RUNNER = path.join(import.meta.dirname, "flow-sql-runner.mjs");

export const WORK_WHY = {
  missing: "missing_value",
  value: "value_too_large",
  commandsLimited: "command_limited",
  writesLimited: "write_limited",
  codeFailed: "code_failed",
  codeTimeout: "code_timeout",
  codeLarge: "code_too_large",
  database: "database_unavailable",
  queryFailed: "query_failed",
  queryTimeout: "query_timeout",
  writeUnknown: "write_uncertain",
  folder: "folder_unavailable",
  commandFailed: "command_failed",
  commandTimeout: "command_timeout",
  commandUnknown: "command_uncertain",
  start: "not_started",
  secret: "secret_missing",
} as const;

class StepRefused extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.why = why;
  }
}

/** A template as one value: a placeholder alone keeps its value's type, anything else is text. */
function templateValue(
  template: string,
  resolve: (b: FlowBinding) => unknown,
  graph: FlowGraph,
  apx: FlowApx,
): unknown {
  const parts = parseFlowTemplate(template, flowVarIndex(graph));
  const only = parts.length === 1 ? parts[0] : undefined;
  return only && "binding" in only ? resolve(only.binding) : renderFlowTemplate(parts, resolve, { apx }).text;
}
const templateText = (template: string, resolve: (b: FlowBinding) => unknown, graph: FlowGraph, apx: FlowApx) =>
  renderFlowTemplate(parseFlowTemplate(template, flowVarIndex(graph)), resolve, { apx }).text;

/** Steps on every path before `id`. */
function ancestors(graph: FlowGraph, id: string): Set<string> {
  const seen = new Set<string>();
  const todo = [id];
  for (let at = todo.pop(); at !== undefined; at = todo.pop())
    for (const e of graph.edges)
      if (e.target === at && !seen.has(e.source)) {
        seen.add(e.source);
        todo.push(e.source);
      }
  return seen;
}

/** The variables set before a step, by name. */
function varsBefore(run: FlowGraphRun, id: string, snapshots: Map<string, FlowNodeSnapshot>) {
  const before = ancestors(run.graph, id);
  const out: Record<string, unknown> = Object.create(null);
  for (const n of run.graph.nodes) {
    const s = snapshots.get(n.id);
    if (n.kind === "vars" && before.has(n.id) && s?.state === "succeeded" && s.output && typeof s.output === "object")
      Object.assign(out, s.output);
  }
  // Code never sees a variable holding a secret, not even its reference (DECISIONS.md#d-173).
  for (const name of flowSecretVars(run.graph).keys()) delete out[name];
  return out;
}

type ChildAnswer = { ok: true; json?: string; value?: unknown } | { ok: false; error: string; message?: string };
type ChildEnd = { answer?: ChildAnswer; timedOut: boolean; stopped: boolean; tooLarge: boolean };

/**
 * Runs a runner in a Node of its own: the permission model on (it may read only its own file: no other files, no
 * processes, no workers), no code from strings, a small heap and an empty environment. Killed at `timeoutMs`, on
 * `signal` or past `outLimit` bytes of output.
 */
function runChild(
  runner: string,
  request: unknown,
  o: { timeoutMs: number; signal: AbortSignal; outLimit: number },
): Promise<ChildEnd> {
  return new Promise((resolve) => {
    const end: ChildEnd = { timedOut: false, stopped: false, tooLarge: false };
    const child = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${realpath(runner)}`,
        "--disallow-code-generation-from-strings",
        `--max-old-space-size=${HEAP_MB}`,
        "--no-warnings",
        runner,
      ],
      { cwd: os.tmpdir(), env: nodeChildEnv(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    let out = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.signal.removeEventListener("abort", stop);
      const line = out.trim().split("\n").at(-1);
      if (line && !end.tooLarge)
        try {
          const parsed = JSON.parse(line) as ChildAnswer;
          if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") end.answer = parsed;
        } catch {}
      resolve(end);
    };
    const kill = () => {
      child.kill("SIGKILL");
    };
    const stop = () => {
      end.stopped = true;
      kill();
    };
    const timer = setTimeout(() => {
      end.timedOut = true;
      kill();
    }, o.timeoutMs);
    timer.unref?.();
    if (o.signal.aborted) stop();
    else o.signal.addEventListener("abort", stop, { once: true });
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > o.outLimit) {
        end.tooLarge = true;
        kill();
      }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(request));
    child.on("error", finish);
    child.on("close", finish);
  });
}

/**
 * Where a Flow's commands run and its databases are: its project's folder, real. A project without a folder of its
 * own gets APX's side folder for it, made on first use; a folder that is gone is undefined.
 */
type CodeRequest = { code: string; input: unknown; vars: Record<string, unknown>; timeoutMs: number };
type SqlRequest = {
  file: string;
  mode: "read" | "write";
  query: string;
  params: Record<string, unknown>;
  maxRows: number;
  timeoutMs: number;
};

/** A code step's run, apart: the runner's own limit stops the code, the process limit a little later anything else. */
export const runFlowCode = (r: CodeRequest, signal = new AbortController().signal) =>
  runChild(JS_RUNNER, r, { timeoutMs: r.timeoutMs + 1500, signal, outLimit: CODE_OUT });
/** A SQL step's statement, apart, stopped at its time limit. */
export const runFlowSql = (r: SqlRequest, signal = new AbortController().signal) =>
  runChild(
    SQL_RUNNER,
    {
      file: r.file,
      mode: r.mode,
      query: r.query,
      params: r.params,
      maxRows: r.maxRows,
      maxBytes: ROW_BYTES,
      busyMs: 2000,
    },
    { timeoutMs: r.timeoutMs, signal, outLimit: SQL_OUT },
  );

export function flowFolder(store: Store, home: string | undefined, projectId: string): string | undefined {
  const project = store.projects.get(projectId);
  if (!project || !home) return undefined;
  const dir = workDir(store, home, { project_id: project.id });
  if (!(project.path && project.present)) fs.mkdirSync(dir, { recursive: true });
  return fs.existsSync(dir) ? real(dir) : undefined;
}

/**
 * The database file a step names, inside its project's folder, never a link and never one of APX's own (its database,
 * its secrets): inside APX's folder only a project's own side folder is a step's. A read needs the file; a write may
 * make it, in a folder that is there.
 */
export function flowDatabaseFile(folder: string, home: string | undefined, node: Sql): string | undefined {
  if (flowDatabaseProblem(node.database)) return undefined;
  const named = path.resolve(folder, node.database);
  // A link is refused even when it points nowhere yet: opening it would make the file wherever it points.
  let link = false;
  try {
    link = fs.lstatSync(named).isSymbolicLink();
  } catch {}
  if (link) return undefined;
  const file = real(named);
  if (!isInside(folder, file) || file === folder) return undefined;
  const apx = home ? real(home) : undefined;
  if (apx && isInside(apx, file) && !isInside(path.join(apx, "projects"), folder)) return undefined;
  const exists = fs.existsSync(file);
  if (exists ? !fs.statSync(file).isFile() : node.mode === "read" || !fs.existsSync(path.dirname(file)))
    return undefined;
  return file;
}

/** A command's environment: the owner's minus credentials, as routines' commands get, and minus connection strings. */
export function flowCommandEnv(): Record<string, string> {
  const env = commandEnv();
  for (const k of Object.keys(env)) if (CONNECTION_NAME.test(k)) delete env[k];
  return env;
}
const CONNECTION_NAME = /(DSN|DATABASE_URL|_URI$|CONNECTION|_PAT$|^PAT$|PASSWD|CREDS?$)/i;

export function createWorkSteps(deps: {
  store: Store;
  timers: RunTimers;
  /** APX's own folder: a project without a folder of its own works in it, and its database is never a step's. */
  home: string | undefined;
  /** Registers a process in flight so a stop or the deadline ends it. */
  track(ac: AbortController, run: FlowGraphRun): () => void;
  /** A `secret://name` in a command's environment, read for the Flow's project. */
  secret?: ((ref: string, project: string) => string | undefined) | undefined;
}) {
  const { store } = deps;
  const runs = store.flowGraphRuns;
  const now = () => new Date(deps.timers.now());
  const W = WORK_WHY;
  const left = (run: FlowGraphRun, ms: number) => Math.max(0, Math.min(ms, run.deadline - deps.timers.now()));
  const fail = (
    k: FlowStepKey,
    from: "pending" | "running",
    why: string,
    o: { to?: "failed" | "uncertain"; output?: unknown } = {},
  ) => runs.settle(k, [from], o.to ?? "failed", now(), why, o.output);
  /** The step's result, or why it couldn't keep it (too large to keep as data). */
  const keep = (k: FlowStepKey, run: FlowGraphRun, value: unknown) => {
    try {
      runs.succeed(k, "running", value, now(), run.deadline);
    } catch {
      fail(k, "running", W.value);
    }
  };
  const folderOf = (run: FlowGraphRun): string | undefined => {
    const flow = store.flows.get(run.flow);
    return flow && flowFolder(store, deps.home, flow.projectId);
  };
  /** The step's limit for this kind of effect in the last hour, counted and committed with `dispatched`. */
  const dispatch = (run: FlowGraphRun, k: FlowStepKey, kind: "command" | "write", perHour: number) => {
    const at = now();
    return store.tx(() => {
      if (store.flowSends.count(run.flow, kind, new Date(at.getTime() - 3600_000)) >= perHour) return "limited";
      if (!runs.dispatch(k, at, run.deadline)) return "ended";
      store.flowSends.add(run.flow, kind, at);
      return "go";
    });
  };

  async function js(run: FlowGraphRun, node: Js, k: FlowStepKey, snapshots: Map<string, FlowNodeSnapshot>) {
    let input: unknown;
    let vars: Record<string, unknown>;
    try {
      input = resolveFlowInput(node.input, run.payload, snapshots);
      vars = boundedFlowValue(varsBefore(run, node.id, snapshots)) as Record<string, unknown>;
    } catch {
      fail(k, "pending", W.missing);
      return;
    }
    try {
      if (!runs.claim(k, { input, vars }, now(), null)) return;
    } catch {
      fail(k, "pending", W.value);
      return;
    }
    const ac = new AbortController();
    const untrack = deps.track(ac, run);
    const end = await runFlowCode(
      { code: node.code, input, vars, timeoutMs: left(run, node.timeoutMs) },
      ac.signal,
    ).finally(untrack);
    // Stopped or closing: a stop already ended the step, and after a restart code starts over.
    if (end.stopped) return;
    const a = end.answer;
    if (a?.ok && typeof a.json === "string") {
      let value: unknown;
      try {
        value = boundedFlowValue(JSON.parse(a.json));
      } catch {
        fail(k, "running", W.codeLarge);
        return;
      }
      keep(k, run, value);
      return;
    }
    if (end.tooLarge) fail(k, "running", W.codeLarge);
    else if (end.timedOut || (a && !a.ok && a.error === W.codeTimeout)) fail(k, "running", W.codeTimeout);
    else if (a && !a.ok && a.error === W.codeLarge) fail(k, "running", W.codeLarge);
    else fail(k, "running", W.codeFailed, a && !a.ok && a.message ? { output: { error: a.message } } : {});
  }

  const databaseOf = (run: FlowGraphRun, node: Sql): string | undefined => {
    const folder = folderOf(run);
    return folder && flowDatabaseFile(folder, deps.home, node);
  };

  async function sql(run: FlowGraphRun, node: Sql, k: FlowStepKey, snapshots: Map<string, FlowNodeSnapshot>) {
    const resolve = (b: FlowBinding) => resolveFlowInput(b, run.payload, snapshots);
    const shape = flowSqlShape(node.query);
    const allowed = (node.mode === "read" ? SQL_READS : SQL_WRITES).has(shape.first);
    if (!allowed || shape.statements !== 1 || shape.positional) {
      fail(k, "pending", W.queryFailed);
      return;
    }
    const file = databaseOf(run, node);
    if (!file) {
      fail(k, "pending", W.database);
      return;
    }
    let params: Record<string, unknown>;
    try {
      params = boundedFlowValue(
        Object.fromEntries(
          node.params.map((p) => [
            p.name,
            templateValue(p.value, resolve, run.graph, flowApx(store, run, now())) ?? null,
          ]),
        ),
      ) as Record<string, unknown>;
    } catch {
      fail(k, "pending", W.missing);
      return;
    }
    const writes = node.mode === "write";
    const shown = { database: node.database, mode: node.mode, query: node.query, params };
    try {
      // A read changes nothing: after a restart it can start over, so it never commits that it went out.
      if (!runs.claim(k, shown, now(), writes ? "reserved" : null)) return;
    } catch {
      fail(k, "pending", W.value);
      return;
    }
    if (writes) {
      const go = dispatch(run, k, "write", FLOW_WRITES_PER_HOUR);
      if (go === "limited") fail(k, "running", W.writesLimited);
      if (go !== "go") return;
    }
    const ac = new AbortController();
    const untrack = deps.track(ac, run);
    const end = await runFlowSql(
      { file, mode: node.mode, query: node.query, params, maxRows: node.maxRows, timeoutMs: left(run, node.timeoutMs) },
      ac.signal,
    ).finally(untrack);
    if (end.stopped) return;
    const a = end.answer;
    if (a?.ok) {
      keep(k, run, a.value ?? {});
      return;
    }
    // A statement SQLite refused or that failed changed nothing; one stopped or cut off may have.
    if (a && !a.ok && (a.error === W.queryFailed || a.error === W.database))
      fail(k, "running", a.error, a.message ? { output: { error: a.message } } : {});
    else if (writes) fail(k, "running", W.writeUnknown, { to: "uncertain" });
    else fail(k, "running", end.timedOut ? W.queryTimeout : W.queryFailed);
  }

  async function cmd(run: FlowGraphRun, node: Cmd, k: FlowStepKey, snapshots: Map<string, FlowNodeSnapshot>) {
    const resolve = (b: FlowBinding) => resolveFlowInput(b, run.payload, snapshots);
    const folder = folderOf(run);
    if (!folder) {
      fail(k, "pending", W.folder);
      return;
    }
    const env: Record<string, string> = {};
    const shownEnv: Record<string, string> = {};
    const used: string[] = [];
    const apx = flowApx(store, run, now());
    const project = store.flows.get(run.flow)?.projectId ?? "";
    let stdin: string;
    const secretVars = flowSecretVars(run.graph);
    try {
      for (const e of node.env) {
        if (FLOW_ENV_REFUSED.test(e.name)) throw new StepRefused(W.start);
        const parts = secretTemplate(e.value, flowVarIndex(run.graph), secretVars);
        if (!parts) throw new StepRefused(W.missing);
        // A secret is read only in the owner's own text, never in a value the payload brought (DECISIONS.md#d-172).
        env[e.name] = renderFlowTemplate(parts, resolve, {
          apx,
          literal: (t) =>
            t.replace(SECRET_REF, (ref) => {
              const value = deps.secret?.(ref, project);
              if (value === undefined) throw new StepRefused(W.secret);
              used.push(value);
              return value;
            }),
        }).text;
        shownEnv[e.name] = renderFlowTemplate(parts, resolve, { apx }).text;
      }
      stdin = templateText(node.stdin, resolve, run.graph, apx);
      if (Buffer.byteLength(stdin) > INPUT_LIMIT || Buffer.byteLength(JSON.stringify(env)) > INPUT_LIMIT)
        throw new StepRefused(W.value);
    } catch (err) {
      fail(k, "pending", err instanceof StepRefused ? err.why : W.missing);
      return;
    }
    const shown = {
      command: node.command,
      folder: tildeHome(folder),
      ...(node.env.length ? { env: shownEnv } : {}),
      ...(stdin ? { stdin } : {}),
    };
    try {
      if (!runs.claim(k, shown, now(), "reserved")) return;
    } catch {
      fail(k, "pending", W.value);
      return;
    }
    const go = dispatch(run, k, "command", FLOW_COMMANDS_PER_HOUR);
    if (go === "limited") fail(k, "running", W.commandsLimited);
    if (go !== "go") return;
    const ac = new AbortController();
    const untrack = deps.track(ac, run);
    // The owner's own environment minus credentials, as routines' commands get; the step's values after it.
    const r = await runStep(node.command, {
      cwd: folder,
      env: { ...flowCommandEnv(), ...env },
      signal: ac.signal,
      timeoutMs: left(run, node.timeoutMs),
      ...(stdin ? { stdin } : {}),
    }).finally(untrack);
    // Stopped by the owner (already left to look at) or closing (a restart marks it uncertain).
    if (ac.signal.aborted) return;
    // What it printed never keeps a secret it was given, as an HTTP step's answer does not.
    const cut = secretScrubber(used);
    const scrub = <T extends string | undefined>(text: T): T => (text === undefined ? text : (cut(text) as T));
    const output = { exit: r.exit, ok: r.exit === 0, stdout: scrub(r.stdout), stderr: scrub(r.stderr) };
    if (r.timedOut) fail(k, "running", W.commandTimeout, { to: "uncertain", output });
    // Ended by a signal (it crashed, or something outside stopped it): it ran, so what it did is not known.
    else if (r.signal) fail(k, "running", W.commandUnknown, { to: "uncertain", output });
    else if (r.exit === null) fail(k, "running", W.start, { output: { error: scrub(r.output).slice(0, 500) } });
    else if (r.exit !== 0 && !node.continueOnError) fail(k, "running", W.commandFailed, { output });
    else keep(k, run, output);
  }

  return { js, sql, cmd };
}
