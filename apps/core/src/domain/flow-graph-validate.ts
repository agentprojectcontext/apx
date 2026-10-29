import {
  FLOW_OTHERWISE,
  type FlowCase,
  flowBranches,
  flowCases,
} from "../../../../packages/protocol/src/flow-cases.ts";
import {
  type FlowBinding,
  FlowGraph,
  type FlowGraphIssue,
  type FlowNode,
} from "../../../../packages/protocol/src/flow-graph.ts";
import { FlowExprError, type FlowVarIndex, flowExprBindings, parseFlowExpr } from "./flow-expr.ts";
import { flowHttpUrlProblem } from "./flow-http-url.ts";
import { flowSqlShape, SQL_READS, SQL_WRITES } from "./flow-sql.ts";
import { flowTemplateBindings, parseFlowTemplate } from "./flow-template.ts";
import { isCliRef } from "./refs.ts";
import { flowCronProblem } from "./schedule.ts";

export { FLOW_OTHERWISE, type FlowCase, flowBranches, flowCases };

/** Which step sets each variable (the first, when validation would refuse a second). */
export function flowVarIndex(graph: Pick<FlowGraph, "nodes">): Map<string, string> {
  const index = new Map<string, string>();
  for (const n of graph.nodes)
    if (n.kind === "vars") for (const v of n.vars) if (!index.has(v.name)) index.set(v.name, n.id);
  return index;
}

/** A run starts at its one trigger: a POST or a schedule. */
export const isFlowTrigger = (node: FlowNode): boolean => node.kind === "webhook" || node.kind === "schedule";

/** Steps that act outside APX: a message sent as the owner, a request to another service. */
export const isFlowOutward = (node: FlowNode): boolean => node.kind === "notify" || node.kind === "http";
/** Steps that change things on this computer: a command, a write to a database. */
export const isFlowLocalEffect = (node: FlowNode): boolean =>
  node.kind === "cmd" || (node.kind === "sql" && node.mode === "write");
const OUTWARD_LIMIT = 8;
/** Commands, SQL statements and code steps: each runs in a process of its own. */
const PROCESS_LIMIT = 8;

/** Environment variables a step may not set: they change what the shell runs or where it looks. */
export const FLOW_ENV_REFUSED =
  /^(PATH|HOME|SHELL|IFS|ENV|BASH_ENV|BASH_FUNC_.*|CDPATH|PS[0-9]|PROMPT_COMMAND|SHELLOPTS|BASHOPTS|GLOBIGNORE|HISTFILE|ZDOTDIR|TMPDIR|TMP|TEMP|USER|LOGNAME|LANG|LANGUAGE|LC_[A-Z_]*|TERM|EDITOR|VISUAL|PAGER|COMSPEC|PATHEXT|SYSTEMROOT|WINDIR|(GIT|SSH|LD|DYLD|NODE|NPM|PNPM|YARN|PYTHON|PERL|RUBY|GEM|BUNDLE|CURL|PIP|APX|DOCKER|KUBE|AWS|GOOGLE|AZURE)[A-Z0-9_]*|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES.*|PSMODULEPATH|[A-Z0-9_]*PROXY|[A-Z0-9_]*PATH|[A-Z0-9_]*_HOME|[A-Z0-9_]*OPTIONS?|[A-Z0-9_]*OPTS|[A-Z0-9_]*RC)$/i;
/** A placeholder written into a command's text: it would never be filled (values go in its environment or input). */
const IN_COMMAND = /\$(trigger|steps|vars|apx)\b/;

/** The templates of a step, where its placeholders are. */
export function flowNodeTemplates(node: FlowNode): string[] {
  if (node.kind === "notify") return [node.text];
  if (node.kind === "http") return [...node.headers.map((h) => h.value), node.body];
  if (node.kind === "sql") return node.params.map((p) => p.value);
  if (node.kind === "cmd") return [...node.env.map((e) => e.value), node.stdin];
  return [];
}

/** The expressions of a step: a check's cases, a variables step's values. */
export function flowNodeExprs(node: FlowNode): string[] {
  if (node.kind === "condition") return flowCases(node).flatMap((c) => (c.match.kind === "expr" ? [c.match.expr] : []));
  if (node.kind === "vars") return node.vars.flatMap((v) => (v.value.kind === "expr" ? [v.value.expr] : []));
  return [];
}

export function flowNodeBindings(node: FlowNode, vars: FlowVarIndex = new Map()): FlowBinding[] {
  const own: FlowBinding[] = [];
  if (node.kind === "condition") {
    if (flowCases(node).some((c) => c.match.kind === "equals")) own.push(node.input);
  } else if (node.kind === "llm" || node.kind === "agent" || node.kind === "routine" || node.kind === "js")
    own.push(node.input);
  else if (node.kind === "table_write") own.push(node.value);
  try {
    own.push(...flowNodeTemplates(node).flatMap((t) => flowTemplateBindings(t, vars)));
    for (const expr of flowNodeExprs(node)) own.push(...flowExprBindings(parseFlowExpr(expr), vars));
  } catch {
    // validateFlowGraph says why.
  }
  // A variable may read one set above it in the same step.
  return node.kind === "vars" ? own.filter((b) => b.kind !== "node" || b.node !== node.id) : own;
}

/** Headers the request sets itself, or that would change how it reaches the service. */
const OWN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-connection",
]);

type Add = (code: string, message: string, node?: string) => void;

/** A SQL file named inside the project: a relative path that never climbs out of it. */
export const flowDatabaseProblem = (file: string): string | undefined =>
  /[\0\\]/.test(file) || file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.startsWith("~") || /^file:/i.test(file)
    ? "The database is a file inside the project, like data/app.db"
    : file.split("/").some((s) => s === ".." || s === "")
      ? "The database is a file inside the project, like data/app.db"
      : undefined;

/** An AI model step answers as an agent or as a bot, never both; its mode is the one its harness has. */
function aiIssues(node: Extract<FlowNode, { kind: "agent" }>, add: Add) {
  if (Boolean(node.agent) === Boolean(node.bot)) add("ai_source", "Choose an agent or write a bot", node.id);
  const cli = Boolean(node.model && isCliRef(node.model));
  if (cli ? node.autonomy || node.delegate : node.write)
    add("ai_mode", "That permission mode belongs to another harness", node.id);
  if (node.bot && node.delegate) add("ai_mode", "A bot of the flow hands work to no one", node.id);
}

/** Checks, variables, code, SQL and commands: what the drawing alone can tell. */
function workIssues(node: FlowNode, add: Add, vars: FlowVarIndex) {
  const expr = (src: string) => {
    try {
      flowExprBindings(parseFlowExpr(src), vars);
    } catch (err) {
      add("expr_invalid", err instanceof FlowExprError ? err.message : "The expression can't be read", node.id);
    }
  };
  if (node.kind === "condition") {
    if (!node.cases && node.equals === undefined) add("check_empty", "The check has no case", node.id);
    const ids = new Set<string>();
    for (const c of flowCases(node)) {
      if (c.id === FLOW_OTHERWISE) add("case_reserved", "“no” is the otherwise way out", node.id);
      if (ids.has(c.id)) add("case_duplicate", "Each case once", node.id);
      ids.add(c.id);
      if (c.match.kind === "expr") expr(c.match.expr);
    }
  }
  if (node.kind === "vars")
    node.vars.forEach((v, i) => {
      if (v.value.kind !== "expr") return;
      expr(v.value.expr);
      try {
        for (const b of flowExprBindings(parseFlowExpr(v.value.expr), vars))
          if (b.kind === "node" && b.node === node.id && node.vars.findIndex((x) => x.name === b.path[0]) >= i)
            add("var_order", "A value reads only variables set above it", node.id);
      } catch {}
    });
  if (node.kind === "sql") {
    const where = flowDatabaseProblem(node.database);
    if (where) add("database_invalid", where, node.id);
    const shape = flowSqlShape(node.query);
    if (shape.statements !== 1) add("sql_statements", "One statement per step", node.id);
    if (!(node.mode === "read" ? SQL_READS : SQL_WRITES).has(shape.first))
      add(
        node.mode === "read" ? "sql_not_read" : "sql_refused",
        node.mode === "read"
          ? "A read starts with SELECT or WITH"
          : "A write inserts, updates, deletes or creates a table or an index",
        node.id,
      );
    if (shape.positional) add("sql_positional", "Name each value, like :email", node.id);
    const given = new Set<string>();
    for (const p of node.params) {
      if (given.has(p.name)) add("sql_param_duplicate", "Each value once", node.id);
      given.add(p.name);
    }
    for (const name of shape.names)
      if (!given.has(name)) add("sql_param_missing", `The query uses :${name} and no value is given`, node.id);
  }
  if (node.kind === "cmd") {
    if (!node.command.trim()) add("command_empty", "The command is empty", node.id);
    if (IN_COMMAND.test(node.command))
      add("command_placeholder", "Pass values in the environment or the input, not in the command", node.id);
    const names = new Set<string>();
    for (const e of node.env) {
      if (FLOW_ENV_REFUSED.test(e.name)) add("env_refused", "That variable changes how the command runs", node.id);
      if (names.has(e.name.toUpperCase())) add("env_duplicate", "Each variable once", node.id);
      names.add(e.name.toUpperCase());
    }
  }
}

function outwardIssues(node: FlowNode, add: Add, vars: FlowVarIndex) {
  for (const template of flowNodeTemplates(node)) {
    try {
      parseFlowTemplate(template, vars);
    } catch {
      add("template_invalid", "A placeholder names no step or field", node.id);
    }
  }
  if (node.kind === "notify" && !node.text.trim()) add("message_empty", "The message is empty", node.id);
  if (node.kind !== "http") return;
  const problem = flowHttpUrlProblem(node.url);
  if (problem === "invalid") add("url_invalid", "The address is not a web address", node.id);
  // A private address is checked with the owner's setup (flow-outward.ts), where a test may let its own server in.
  if (problem === "secret") add("url_secret", "Secrets go in a header, not in the address", node.id);
  if (node.method === "GET" && node.body) add("get_body", "A GET request has no body", node.id);
  if (node.body.includes("secret://")) add("body_secret", "Secrets go in a header, not in the body", node.id);
  // Said to be JSON, a body must be JSON for its values to be filled as JSON (never pasted into its text).
  const type = node.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  if (/json/i.test(type) && node.body.trim()) {
    try {
      JSON.parse(node.body);
    } catch {
      add("body_not_json", "The body is not JSON", node.id);
    }
  }
  const names = new Set<string>();
  for (const h of node.headers) {
    const name = h.name.toLowerCase();
    if (OWN_HEADERS.has(name) || name.startsWith("proxy-"))
      add("header_refused", "That header is set by the request itself", node.id);
    if (names.has(name)) add("header_duplicate", "Each header once", node.id);
    names.add(name);
    if (/[\r\n\0]/.test(h.value)) add("header_invalid", "A header value is one line", node.id);
  }
}

export function validateFlowGraph(value: FlowGraph): FlowGraphIssue[] {
  const graph = FlowGraph.parse(value);
  const issues: FlowGraphIssue[] = [];
  const add = (code: string, message: string, node?: string) =>
    issues.push({ code, message, ...(node ? { node } : {}) });
  if (Buffer.byteLength(JSON.stringify(graph)) > 131072) add("graph_size", "Graph exceeds 128 KiB");
  const nodes = new Map<string, FlowNode>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) add("duplicate_node", "Node identifiers must be unique", node.id);
    nodes.set(node.id, node);
  }
  const triggers = graph.nodes.filter(isFlowTrigger);
  if (triggers.length !== 1) add("trigger_count", "A graph needs exactly one trigger");
  for (const node of graph.nodes) {
    if (node.kind !== "schedule") continue;
    const problem = flowCronProblem(node.cron);
    if (problem === "invalid") add("schedule_invalid", "The schedule is not a valid cron expression", node.id);
    if (problem === "too_often") add("schedule_too_often", "A schedule runs at most every five minutes", node.id);
  }
  if (graph.nodes.filter((node) => node.kind === "llm").length > 4)
    add("model_limit", "A graph supports at most four LLM nodes");
  if (graph.nodes.filter(isFlowOutward).length > OUTWARD_LIMIT)
    add("outward_limit", "A graph sends or calls out at most eight times");
  if (graph.nodes.filter((n) => n.kind === "cmd" || n.kind === "sql" || n.kind === "js").length > PROCESS_LIMIT)
    add("process_limit", "A graph runs at most eight commands, queries and code steps");
  const vars = flowVarIndex(graph);
  const named = new Set<string>();
  for (const node of graph.nodes)
    if (node.kind === "vars")
      for (const v of node.vars) {
        if (named.has(v.name)) add("var_duplicate", `$vars.${v.name} is set twice`, node.id);
        named.add(v.name);
      }
  for (const node of graph.nodes) {
    outwardIssues(node, add, vars);
    workIssues(node, add, vars);
    if (node.kind === "agent") aiIssues(node, add);
  }
  const parents = new Map<string, Set<string>>([...nodes.keys()].map((id) => [id, new Set()]));
  const edges = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      add("unknown_endpoint", "Connection refers to an unknown node");
      continue;
    }
    const key = JSON.stringify([edge.source, edge.target]);
    if (edges.has(key)) add("duplicate_edge", "Connections must be unique", edge.target);
    edges.add(key);
    parents.get(edge.target)?.add(edge.source);
    if (edge.source === edge.target) add("self_edge", "A node cannot connect to itself", edge.target);
    const source = nodes.get(edge.source);
    if (edge.when && source?.kind !== "condition")
      add("branch_source", "Only a check has yes and no branches", edge.target);
    if (source?.kind === "condition" && !flowBranches(source).includes(edge.when ?? "yes"))
      add("branch_unknown", "A connection leaves a check by a case it doesn't have", edge.target);
    const target = nodes.get(edge.target);
    if (target && isFlowTrigger(target))
      add("trigger_input", "The trigger cannot have incoming connections", edge.target);
  }
  const ancestors = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const visit = (id: string): Set<string> => {
    const saved = ancestors.get(id);
    if (saved) return saved;
    if (visiting.has(id)) {
      add("cycle", "Graphs cannot contain cycles", id);
      return new Set();
    }
    visiting.add(id);
    const found = new Set<string>();
    for (const parent of parents.get(id) ?? []) {
      found.add(parent);
      for (const ancestor of visit(parent)) found.add(ancestor);
    }
    visiting.delete(id);
    ancestors.set(id, found);
    return found;
  };
  for (const node of graph.nodes) {
    const before = visit(node.id);
    if (!isFlowTrigger(node) && triggers.length === 1 && !before.has(triggers[0]?.id ?? ""))
      add("disconnected", "Every node must be reachable from the trigger", node.id);
    for (const binding of flowNodeBindings(node, vars)) {
      if (binding.kind === "node" && (binding.node === node.id || !before.has(binding.node)))
        add("binding_ancestor", "An output binding must refer to a connected ancestor", node.id);
    }
  }
  const writes = graph.nodes.filter((node) => node.kind === "table_write");
  for (let i = 0; i < writes.length; i++) {
    const first = writes[i];
    if (!first) continue;
    for (const second of writes.slice(i + 1)) {
      if (
        first.key === second.key &&
        !ancestors.get(first.id)?.has(second.id) &&
        !ancestors.get(second.id)?.has(first.id)
      )
        add("unordered_write", "Writes to the same key require an explicit dependency", second.id);
    }
  }
  const positions = new Set<string>();
  for (const position of graph.layout) {
    if (!nodes.has(position.node) || positions.has(position.node))
      add("layout_node", "Layout must refer to unique existing nodes", position.node);
    positions.add(position.node);
  }
  return issues;
}

export function resolveFlowBinding(
  binding: FlowBinding,
  event: unknown,
  outputs: ReadonlyMap<string, unknown>,
): unknown {
  if (binding.kind === "literal") return binding.value;
  let value = binding.kind === "event" ? event : outputs.get(binding.node);
  if (binding.kind === "node" && !outputs.has(binding.node)) throw new Error("Flow node output is unavailable");
  for (const segment of binding.path) {
    if (
      ["__proto__", "constructor", "prototype"].includes(segment) ||
      value === null ||
      typeof value !== "object" ||
      (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(segment) || Number(segment) >= value.length)) ||
      !Object.hasOwn(value, segment)
    )
      throw new Error("Flow input field is unavailable");
    const descriptor = Object.getOwnPropertyDescriptor(value, segment);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("Flow input field is unavailable");
    value = descriptor.value;
  }
  if (value === undefined) throw new Error("Flow input field is unavailable");
  return value;
}
