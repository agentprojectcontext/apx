// Runs one extension's plugin in its own process (started with Node's permission model: it reads its folder, writes
// its data folder, starts no processes). Lines of JSON on stdin/stdout are the only way to talk with APX.
import { lookup } from "node:dns/promises";
import { registerHooks } from "node:module";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const [entry] = process.argv.slice(2);
const network = process.env.APX_PLUGIN_NETWORK === "1";

// No raw sockets or servers: the network, when allowed, is fetch to the outside only.
const DENIED = new Set([
  "net",
  "tls",
  "http",
  "https",
  "http2",
  "dgram",
  "dns",
  "child_process",
  "worker_threads",
  "cluster",
  "inspector",
  "module",
  "repl",
]);
const bare = (s) => String(s).replace(/^node:/, "");
registerHooks({
  resolve(spec, ctx, next) {
    if (DENIED.has(bare(spec))) throw new Error(`${spec} is not available to APX plugins`);
    return next(spec, ctx);
  },
});
const builtin = process.getBuiltinModule.bind(process);
process.getBuiltinModule = (id) => {
  if (DENIED.has(bare(id))) throw new Error(`${id} is not available to APX plugins`);
  return builtin(id);
};

// This machine (APX listens on it) and cloud metadata addresses are never reachable.
const closed = (ip) =>
  /^(127\.|0\.|169\.254\.)/.test(ip) ||
  ip === "::1" ||
  ip === "::" ||
  /^::ffff:(127\.|0\.|169\.254\.)/i.test(ip) ||
  /^fe80:/i.test(ip);
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!network) throw new Error("this plugin did not ask for the network");
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) is allowed");
  const addrs = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addrs.length || addrs.some((a) => closed(a.address)))
    throw new Error(`${url.hostname} is not reachable from a plugin`);
  return realFetch(input, { ...init, redirect: "manual" });
};
for (const name of ["WebSocket", "EventSource"]) delete globalThis[name];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const handlers = new Map();
let contextFn;
const api = {
  dataDir: process.env.APX_DATA_DIR,
  secrets: Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.startsWith("APX_SECRET_"))
      .map(([k, v]) => [k.slice(11).toLowerCase(), v]),
  ),
  on(type, fn) {
    handlers.set(type, [...(handlers.get(type) ?? []), fn]);
  },
  context(fn) {
    contextFn = fn;
  },
  log(text) {
    send({ t: "log", text: String(text).slice(0, 2000) });
  },
};
for (const k of Object.keys(process.env)) if (k.startsWith("APX_SECRET_")) delete process.env[k];

const mod = await import(pathToFileURL(entry).href);
await (mod.default ?? mod.activate)?.(api);
send({ t: "ready" });

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.t === "event") {
    for (const fn of handlers.get(msg.event?.type) ?? []) {
      try {
        await fn(msg.event);
      } catch (err) {
        api.log(`handler failed: ${err?.message ?? err}`);
      }
    }
  } else if (msg.t === "context") {
    let text = null;
    try {
      const out = contextFn ? await contextFn(msg.input) : null;
      text = typeof out === "string" && out.trim() ? out : null;
    } catch (err) {
      api.log(`context failed: ${err?.message ?? err}`);
    }
    send({ t: "context", id: msg.id, text });
  }
});
