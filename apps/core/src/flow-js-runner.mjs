// Runs one Flow code step (DECISIONS.md#d-170), in a process of its own started with Node's permission model (no files,
// no processes, no workers) and a small heap. Node does not restrict the network, so the code never touches this
// process: it runs in a context of its own with nothing from here in it (no require, process, fetch or timers) and no
// code from strings in either realm; only text goes in (JSON) and comes out (JSON). Reads one JSON request on stdin,
// writes one JSON line on stdout.
import vm from "node:vm";

const LIMIT_IN = 256 * 1024;
const write = process.stdout.write.bind(process.stdout);
const say = (answer) => write(`${JSON.stringify(answer)}\n`);
// A promise the code left behind (an import it can't make) must not end this process before it has answered.
process.on("unhandledRejection", () => {});

// What an escape from the context could reach: gone before the code is compiled.
for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "navigator", "Worker", "BroadcastChannel"])
  Reflect.deleteProperty(globalThis, name);
for (const name of [
  "getBuiltinModule",
  "binding",
  "_linkedBinding",
  "dlopen",
  "kill",
  "chdir",
  "abort",
  "_debugProcess",
])
  try {
    Object.defineProperty(process, name, { value: undefined, configurable: false, writable: false });
  } catch {}

/** The whole run; each early return ends this process once its last line is written (never process.exit). */
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > LIMIT_IN) return { ok: false, error: "code_too_large" };
  }
  const { code, input, vars, timeoutMs } = JSON.parse(raw);

  const context = vm.createContext(Object.create(null), {
    name: "flow",
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: "afterEvaluate",
  });
  // Taken before the code runs, so it can't swap them; a stack hook can't be set to read frames outside the context.
  const run = new vm.Script(`"use strict";
  (() => {
    const S = JSON.stringify, P = JSON.parse, Str = String;
    Object.defineProperty(Error, "prepareStackTrace", { value: undefined, writable: false, configurable: false });
    const said = (e) => {
      try {
        return Str(e !== null && typeof e === "object" && "message" in e ? e.message : e).slice(0, 500);
      } catch {
        return "error";
      }
    };
    return (f, i, v) => {
      try {
        const r = f(P(i), P(v));
        if (r !== null && (typeof r === "object" || typeof r === "function") && typeof r.then === "function")
          return "\\u0000Return a value, not a promise";
        const out = S(r === undefined ? null : r);
        return out === undefined ? "\\u0000The result is not JSON" : out;
      } catch (e) {
        return "\\u0000" + said(e);
      }
    };
  })()`).runInContext(context);

  let fn;
  try {
    fn = vm.compileFunction(`"use strict";\n${code}`, ["input", "vars"], { parsingContext: context });
  } catch (err) {
    return { ok: false, error: "code_failed", message: String(err?.message ?? err).slice(0, 500) };
  }
  context.__run = run;
  context.__f = fn;
  context.__i = JSON.stringify(input ?? null);
  context.__v = JSON.stringify(vars ?? {});
  let out;
  try {
    out = new vm.Script("__run(__f, __i, __v)").runInContext(context, { timeout: timeoutMs });
  } catch (err) {
    // Only this process's own errors get here (a time limit): the code's are text by now.
    return { ok: false, error: err?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "code_timeout" : "code_failed" };
  }
  if (typeof out !== "string") return { ok: false, error: "code_failed" };
  if (out.startsWith("\u0000")) return { ok: false, error: "code_failed", message: out.slice(1) };
  return { ok: true, json: out };
}
say(await main());
