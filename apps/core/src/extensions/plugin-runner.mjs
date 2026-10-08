// Runs one extension's plugin in its own process (started with Node's permission model: it reads its folder, writes
// its data folder, starts no processes). Lines of JSON on stdin/stdout are the only way to talk with APX.
// Node does not restrict the network, so this runner also allows only a short list of built-in modules and gives the
// plugin a fetch that checks every address it connects to. See DECISIONS.md#d-018
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isBuiltin, registerHooks } from "node:module";
import net from "node:net";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const [entry] = process.argv.slice(2);
const network = process.env.APX_PLUGIN_NETWORK === "1";
const localNetwork = process.env.APX_PLUGIN_LOCAL_NETWORK === "1";
const MAX_BODY = 20 * 1024 * 1024;

const ALLOWED = new Set([
  "assert",
  "buffer",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "path",
  "querystring",
  "stream",
  "stream/promises",
  "string_decoder",
  "timers",
  "timers/promises",
  "url",
  "util",
  "zlib",
]);
const bare = (s) => String(s).replace(/^node:/, "");
const refused = (id) => isBuiltin(String(id)) && !ALLOWED.has(bare(id));
registerHooks({
  resolve(spec, ctx, next) {
    if (refused(spec)) throw new Error(`${spec} is not available to APX plugins`);
    return next(spec, ctx);
  },
});
const builtin = process.getBuiltinModule.bind(process);
process.getBuiltinModule = (id) => {
  if (refused(id) || !isBuiltin(String(id))) throw new Error(`${id} is not available to APX plugins`);
  return builtin(id);
};

// This machine (APX listens on it), unspecified and link-local (cloud metadata) addresses are never reachable.
const closed = new net.BlockList();
closed.addSubnet("127.0.0.0", 8, "ipv4");
closed.addSubnet("0.0.0.0", 8, "ipv4");
closed.addSubnet("169.254.0.0", 16, "ipv4");
closed.addAddress("::1", "ipv6");
closed.addAddress("::", "ipv6");
closed.addSubnet("fe80::", 10, "ipv6");
// The local network and the tailnet only when the plugin asked for them (DECISIONS.md#d-057).
if (!localNetwork) {
  for (const [a, bits] of [
    ["10.0.0.0", 8],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["100.64.0.0", 10],
    ["224.0.0.0", 4],
  ])
    closed.addSubnet(a, bits, "ipv4");
  closed.addSubnet("fc00::", 7, "ipv6");
  closed.addSubnet("ff00::", 8, "ipv6");
}
function isClosed(address) {
  const family = net.isIP(address);
  if (family === 4) return closed.check(address, "ipv4");
  if (family !== 6) return true;
  const a = address.toLowerCase();
  // IPv4-mapped (::ffff:127.0.0.1 or ::ffff:7f00:1) is checked as the IPv4 address it is.
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(a);
  if (mapped) {
    const v4 =
      mapped[1] ??
      [mapped[2], mapped[3]]
        .flatMap((h) => {
          const n = parseInt(h, 16);
          return [n >> 8, n & 255];
        })
        .join(".");
    return closed.check(v4, "ipv4");
  }
  return closed.check(a, "ipv6");
}

/** The address actually connected to is the one checked: no second lookup, no rebinding. */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some((a) => isClosed(a.address)))
      return callback(Object.assign(new Error(`${hostname} is not reachable from a plugin`), { code: "EACCES" }));
    callback(null, address, family);
  });
}

/** fetch for plugins: one URL read once, no redirects followed, every connection checked. */
async function pluginFetch(input, init = {}) {
  if (!network) throw new Error("this plugin did not ask for the network");
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input),
  );
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) is allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isClosed(host)) throw new Error(`${host} is not reachable from a plugin`);
  const body =
    init.body == null
      ? undefined
      : typeof init.body === "string"
        ? Buffer.from(init.body)
        : Buffer.from(await new Response(init.body).arrayBuffer());
  const mod = url.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers ?? {}).entries()),
        lookup: guardedLookup,
        signal: init.signal,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) req.destroy(new Error("response too large"));
          else chunks.push(c);
        });
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          const status = res.statusCode ?? 500;
          const empty = status === 204 || status === 304 || (status >= 100 && status < 200);
          resolve(new Response(empty ? null : Buffer.concat(chunks), { status, headers }));
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
globalThis.fetch = pluginFetch;
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
  fetch: pluginFetch,
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
