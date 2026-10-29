// The small expression language of a check's cases and of variables: `$trigger.a`, `$steps.<step>.a`, `$vars.name`,
// literals, comparisons, `&&` `||` `!`, arithmetic, `? :` and a few functions. It is parsed here and evaluated over
// JSON values; nothing is ever run as code, so a payload can only be data (DECISIONS.md#d-170).
import type { FlowBinding } from "../../../../packages/protocol/src/flow-graph.ts";
import { flowValueText } from "./flow-template.ts";

export type FlowExpr =
  | { t: "lit"; v: unknown }
  | { t: "root"; root: "trigger" | "steps" | "vars"; name?: string }
  | { t: "get"; of: FlowExpr; key: FlowExpr }
  | { t: "list"; items: FlowExpr[] }
  | { t: "not"; of: FlowExpr }
  | { t: "neg"; of: FlowExpr }
  | { t: "bin"; op: string; a: FlowExpr; b: FlowExpr }
  | { t: "if"; c: FlowExpr; a: FlowExpr; b: FlowExpr }
  | { t: "call"; fn: string; args: FlowExpr[] };

export class FlowExprError extends Error {}

const MAX_SOURCE = 1000;
const MAX_TOKENS = 400;
const MAX_DEPTH = 32;
const MAX_TEXT = 32 * 1024;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const WORDS: Record<string, string> = { and: "&&", or: "||", not: "!" };
/** Functions an expression may call, and how many arguments each takes. */
const FUNCTIONS: Record<string, [number, number]> = {
  len: [1, 1],
  lower: [1, 1],
  upper: [1, 1],
  trim: [1, 1],
  contains: [2, 2],
  startsWith: [2, 2],
  endsWith: [2, 2],
  number: [1, 1],
  text: [1, 1],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
  abs: [1, 1],
  min: [1, 16],
  max: [1, 16],
  join: [1, 2],
  exists: [1, 1],
};

type Token = { k: "num" | "str" | "id" | "var" | "op"; v: string };

function tokenize(src: string): Token[] {
  if (src.length > MAX_SOURCE) throw new FlowExprError("The expression is too long");
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? "";
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (out.length >= MAX_TOKENS) throw new FlowExprError("The expression is too long");
    const rest = src.slice(i);
    const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      out.push({ k: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let text = "";
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] !== "\\") {
          text += src[j];
          continue;
        }
        const e = src[++j];
        if (e === "n") text += "\n";
        else if (e === "t") text += "\t";
        else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 1, j + 5))) {
          text += String.fromCharCode(Number.parseInt(src.slice(j + 1, j + 5), 16));
          j += 4;
        } else if (e !== undefined) text += e;
      }
      if (j >= src.length) throw new FlowExprError("A text is not closed");
      out.push({ k: "str", v: text });
      i = j + 1;
      continue;
    }
    const name = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      const word = name[0];
      const after = out.at(-1);
      if (word.startsWith("$")) out.push({ k: "var", v: word.slice(1) });
      // After a dot a word is a field's name, whatever it is (`$trigger.not`).
      else if (WORDS[word] && !(after?.k === "op" && after.v === ".")) out.push({ k: "op", v: WORDS[word] });
      else out.push({ k: "id", v: word });
      i += word.length;
      continue;
    }
    const op = /^(?:===|!==|==|!=|<=|>=|&&|\|\||[<>+\-*/%!?:.,()[\]])/.exec(rest);
    if (!op) throw new FlowExprError(`Unexpected “${c}”`);
    out.push({ k: "op", v: op[0] === "===" ? "==" : op[0] === "!==" ? "!=" : op[0] });
    i += op[0].length;
  }
  return out;
}

/** Parses an expression; throws a FlowExprError that says what is wrong in the person's words. */
export function parseFlowExpr(src: string): FlowExpr {
  const tokens = tokenize(src);
  let at = 0;
  let depth = 0;
  const peek = () => tokens[at];
  const isOp = (v: string) => peek()?.k === "op" && peek()?.v === v;
  const take = (v: string) => {
    if (!isOp(v)) throw new FlowExprError(peek() ? `Expected “${v}”` : "The expression ends too soon");
    at++;
  };
  const deeper = <T>(f: () => T): T => {
    if (++depth > MAX_DEPTH) throw new FlowExprError("The expression is nested too deep");
    try {
      return f();
    } finally {
      depth--;
    }
  };
  const ternary = (): FlowExpr =>
    deeper(() => {
      const c = binary(0);
      if (!isOp("?")) return c;
      at++;
      const a = ternary();
      take(":");
      return { t: "if", c, a, b: ternary() };
    });
  const LEVELS = [["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]];
  const binary = (level: number): FlowExpr => {
    if (level >= LEVELS.length) return unary();
    let a = binary(level + 1);
    for (;;) {
      const tok = peek();
      if (tok?.k !== "op" || !LEVELS[level]?.includes(tok.v)) return a;
      at++;
      a = { t: "bin", op: tok.v, a, b: binary(level + 1) };
    }
  };
  const unary = (): FlowExpr =>
    deeper(() => {
      if (isOp("!")) {
        at++;
        return { t: "not", of: unary() };
      }
      if (isOp("-")) {
        at++;
        return { t: "neg", of: unary() };
      }
      return postfix(primary());
    });
  const postfix = (base: FlowExpr): FlowExpr => {
    let e = base;
    for (;;) {
      if (isOp(".")) {
        at++;
        const tok = tokens[at++];
        if (!tok || (tok.k !== "id" && tok.k !== "num")) throw new FlowExprError("A field name is missing after “.”");
        e = { t: "get", of: e, key: { t: "lit", v: tok.v } };
      } else if (isOp("[")) {
        at++;
        const key = ternary();
        take("]");
        e = { t: "get", of: e, key };
      } else return e;
    }
  };
  const primary = (): FlowExpr => {
    const tok = tokens[at++];
    if (!tok) throw new FlowExprError("The expression ends too soon");
    if (tok.k === "num") return { t: "lit", v: Number(tok.v) };
    if (tok.k === "str") return { t: "lit", v: tok.v };
    if (tok.k === "var") {
      if (tok.v === "trigger") return { t: "root", root: "trigger" };
      if (tok.v !== "steps" && tok.v !== "vars")
        throw new FlowExprError(`Unknown “$${tok.v}”: use $trigger, $steps or $vars`);
      // A step or a variable is named, never computed: it is checked before the Flow runs. A step id with a dash
      // is written $steps["my-step"].
      const what = tok.v === "steps" ? "step" : "variable";
      if (isOp("[")) {
        at++;
        const name = tokens[at++];
        if (name?.k !== "str") throw new FlowExprError(`Name a ${what} in quotes`);
        take("]");
        return { t: "root", root: tok.v, name: name.v };
      }
      take(".");
      const name = tokens[at++];
      if (name?.k !== "id" && name?.k !== "num") throw new FlowExprError(`Name a ${what}`);
      return { t: "root", root: tok.v, name: name.v };
    }
    if (tok.k === "id") {
      if (tok.v === "true" || tok.v === "false") return { t: "lit", v: tok.v === "true" };
      if (tok.v === "null") return { t: "lit", v: null };
      const arity = Object.hasOwn(FUNCTIONS, tok.v) ? FUNCTIONS[tok.v] : undefined;
      if (!arity || !isOp("(")) throw new FlowExprError(`Unknown name “${tok.v}”`);
      at++;
      const args: FlowExpr[] = [];
      while (!isOp(")")) {
        args.push(ternary());
        if (!isOp(",")) break;
        at++;
      }
      take(")");
      if (args.length < arity[0] || args.length > arity[1])
        throw new FlowExprError(
          `“${tok.v}” takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]} to ${arity[1]}`} values`,
        );
      return { t: "call", fn: tok.v, args };
    }
    if (tok.v === "(") {
      const e = ternary();
      take(")");
      return e;
    }
    if (tok.v === "[") {
      const items: FlowExpr[] = [];
      while (!isOp("]")) {
        items.push(ternary());
        if (!isOp(",")) break;
        at++;
      }
      take("]");
      return { t: "list", items };
    }
    throw new FlowExprError(`Unexpected “${tok.v}”`);
  };
  const e = ternary();
  if (at < tokens.length) throw new FlowExprError(`Unexpected “${tokens[at]?.v}”`);
  return e;
}

/** Where a variable is set: its name and the step that sets it. */
export type FlowVarIndex = ReadonlyMap<string, string>;

/** What an expression reads, as bindings: `$trigger`, each step it names and the step that sets each variable. */
export function flowExprBindings(e: FlowExpr, vars: FlowVarIndex): FlowBinding[] {
  const out: FlowBinding[] = [];
  const walk = (x: FlowExpr) => {
    if (x.t === "root") out.push(rootBinding(x, vars));
    else if (x.t === "get") {
      walk(x.of);
      walk(x.key);
    } else if (x.t === "list") x.items.forEach(walk);
    else if (x.t === "call") x.args.forEach(walk);
    else if (x.t === "not" || x.t === "neg") walk(x.of);
    else if (x.t === "bin") {
      walk(x.a);
      walk(x.b);
    } else if (x.t === "if") {
      walk(x.c);
      walk(x.a);
      walk(x.b);
    }
  };
  walk(e);
  return out;
}

function rootBinding(x: Extract<FlowExpr, { t: "root" }>, vars: FlowVarIndex): FlowBinding {
  if (x.root === "trigger") return { kind: "event", path: [] };
  const name = x.name ?? "";
  if (x.root === "steps") return { kind: "node", node: name, path: [] };
  const node = vars.get(name);
  if (!node) throw new FlowExprError(`No step sets $vars.${name}`);
  return { kind: "node", node, path: [name] };
}

/** JavaScript's idea of true, for JSON values: false, null, 0, "" and a missing field are not. */
export const flowTruthy = (v: unknown) => !(v === false || v === null || v === undefined || v === 0 || v === "");

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

const text = (v: unknown) => {
  const s = flowValueText(v);
  if (s.length > MAX_TEXT) throw new FlowExprError("A text grew too long");
  return s;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const finite = (n: number) => (Number.isFinite(n) ? n : null);

/** A field of a value, only its own data: a missing field, or one outside JSON, is null. */
function field(of: unknown, key: unknown): unknown {
  if (of === null || typeof of !== "object") return null;
  const k = typeof key === "number" && Number.isInteger(key) ? String(key) : key;
  if (typeof k !== "string" || FORBIDDEN.has(k) || !Object.hasOwn(of, k)) return null;
  if (Array.isArray(of) && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= of.length)) return null;
  const d = Object.getOwnPropertyDescriptor(of, k);
  return d && "value" in d && d.value !== undefined ? d.value : null;
}

/**
 * Evaluates a parsed expression. `resolve` gives a binding's value (it throws when a step's answer is not there);
 * a missing field is null, arithmetic on something that is not a number is null.
 */
export function evalFlowExpr(e: FlowExpr, resolve: (b: FlowBinding) => unknown, vars: FlowVarIndex): unknown {
  const ev = (x: FlowExpr): unknown => {
    switch (x.t) {
      case "lit":
        return x.v;
      case "root":
        return resolve(rootBinding(x, vars));
      case "get":
        return field(ev(x.of), ev(x.key));
      case "list":
        return x.items.map(ev);
      case "not":
        return !flowTruthy(ev(x.of));
      case "neg": {
        const n = num(ev(x.of));
        return n === null ? null : -n;
      }
      case "if":
        return flowTruthy(ev(x.c)) ? ev(x.a) : ev(x.b);
      case "bin":
        return binary(x.op, x.a, x.b);
      case "call":
        return call(
          x.fn,
          x.args.map((a) => ev(a)),
        );
    }
  };
  const binary = (op: string, ea: FlowExpr, eb: FlowExpr): unknown => {
    if (op === "&&") {
      const a = ev(ea);
      return flowTruthy(a) ? ev(eb) : a;
    }
    if (op === "||") {
      const a = ev(ea);
      return flowTruthy(a) ? a : ev(eb);
    }
    const a = ev(ea);
    const b = ev(eb);
    if (op === "==") return same(a, b);
    if (op === "!=") return !same(a, b);
    if (op === "<" || op === "<=" || op === ">" || op === ">=") {
      const both = (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");
      if (!both) return false;
      const [x, y] = [a as number | string, b as number | string];
      return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
    }
    if (op === "+") {
      if (typeof a === "number" && typeof b === "number") return finite(a + b);
      return text(text(a) + text(b));
    }
    const x = num(a);
    const y = num(b);
    if (x === null || y === null) return null;
    if (op === "-") return finite(x - y);
    if (op === "*") return finite(x * y);
    if (op === "/") return y === 0 ? null : finite(x / y);
    return y === 0 ? null : finite(x % y);
  };
  return ev(e);
}

function call(fn: string, args: unknown[]): unknown {
  const [a, b] = args;
  const s = (v: unknown) => (typeof v === "string" ? v : text(v));
  switch (fn) {
    case "len":
      return typeof a === "string" || Array.isArray(a)
        ? a.length
        : a && typeof a === "object"
          ? Object.keys(a).length
          : 0;
    case "lower":
      return s(a).toLowerCase();
    case "upper":
      return s(a).toUpperCase();
    case "trim":
      return s(a).trim();
    case "contains":
      return Array.isArray(a) ? a.some((x) => same(x, b)) : s(a).includes(s(b));
    case "startsWith":
      return s(a).startsWith(s(b));
    case "endsWith":
      return s(a).endsWith(s(b));
    case "number": {
      if (typeof a === "number") return finite(a);
      const n = typeof a === "string" && a.trim() ? Number(a.trim().replace(",", ".")) : Number.NaN;
      return finite(n);
    }
    case "text":
      return text(a);
    case "round": {
      const n = num(a);
      const d = Math.max(0, Math.min(10, Math.trunc(num(b) ?? 0)));
      return n === null ? null : finite(Math.round(n * 10 ** d) / 10 ** d);
    }
    case "floor":
      return num(a) === null ? null : Math.floor(a as number);
    case "ceil":
      return num(a) === null ? null : Math.ceil(a as number);
    case "abs":
      return num(a) === null ? null : Math.abs(a as number);
    case "min":
    case "max": {
      const list = (args.length === 1 && Array.isArray(a) ? a : args).map(num).filter((n): n is number => n !== null);
      return list.length ? (fn === "min" ? Math.min(...list) : Math.max(...list)) : null;
    }
    case "join":
      return Array.isArray(a) ? text(a.map((x) => s(x)).join(b === undefined ? ", " : s(b))) : s(a);
    case "exists":
      return a !== null && a !== undefined;
  }
  return null;
}
