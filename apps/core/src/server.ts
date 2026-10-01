// Composition root: config → identity → db/store → agent runner → router → transports.
// Tests call createCore directly (with a temp home and a fake LLM).

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { BROWSER_CAP } from "@apx/protocol";
import { createEngines, which } from "./agent/engines.ts";
import { type ExternalTurn, harnessCwd, runClaude, runCodex } from "./agent/harness.ts";
import { createLlm, type Llm, llmConfigFromEnv } from "./agent/provider.ts";
import { createRunner, type ExternalRunner } from "./agent/runner.ts";
import { createBus } from "./bus.ts";
import type { CoreConfig } from "./config.ts";
import { openDb } from "./db/db.ts";
import { seed } from "./domain/seed.ts";
import { createStore } from "./domain/store.ts";
import { CallError } from "./errors.ts";
import { readIdentity } from "./identity.ts";
import { createLog } from "./log.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { appHandlers } from "./rpc/app.ts";
import { browserHandlers } from "./rpc/browser.ts";
import { createRouter } from "./rpc/router.ts";
import { systemHandlers } from "./rpc/system.ts";
import { type Gate, originsFor } from "./transport/guard.ts";
import { httpHandler } from "./transport/http.ts";
import { attachWs } from "./transport/ws.ts";

/** The panel built by `pnpm --filter @apx/web build`, when present next to the core in the workspace. */
function defaultWebDist(): string | undefined {
  const dist = path.resolve(import.meta.dirname, "../../web/dist");
  return fs.existsSync(path.join(dist, "index.html")) ? dist : undefined;
}

export async function createCore(
  config: CoreConfig,
  opts: { quiet?: boolean; llm?: Llm; webDist?: string; external?: ExternalRunner } = {},
) {
  const log = createLog("core", opts.quiet);
  const identity = readIdentity(config.home);
  const db = openDb(config.home);
  const bus = createBus();
  const store = createStore(db, bus);
  seed(store);
  store.pruneIdempotency();
  const orphaned = store.failOrphanRuns();
  if (orphaned) log.warn({ orphaned }, "marked runs interrupted by the last restart as failed");

  const broker = createNodeBroker();
  broker.onEvent((_node, event) => {
    if (event.type === "tabs.changed")
      bus.emit({ type: "browser.tabs", tabs: (event.payload as { tabs: unknown[] }).tabs ?? [] });
  });
  const llmConfig = llmConfigFromEnv();
  const llm = opts.llm ?? createLlm(llmConfig);
  const engines = createEngines(store, llmConfig);
  let selfUrl = "";
  // Per-run tool gates for harnesses that reach APX tools out of process (Codex via `apx2 mcp --run`).
  const gates = new Map<string, Pick<ExternalTurn, "tools" | "runTool">>();
  const openGate = (turn: Pick<ExternalTurn, "tools" | "runTool">) => {
    const token = randomBytes(24).toString("hex");
    gates.set(token, turn);
    return token;
  };
  const external: ExternalRunner =
    opts.external ??
    (async (harness, turn) => {
      const cwd = harnessCwd(config.home);
      fs.mkdirSync(cwd, { recursive: true });
      const bin = await which(harness);
      if (!bin) throw new Error(`${harness} is not installed on this machine`);
      if (harness === "claude") return runClaude(turn, { claudePath: bin, cwd });
      const token = openGate(turn);
      try {
        return await runCodex(turn, {
          codexPath: bin,
          cwd,
          mcpCommand: {
            command: process.execPath,
            args: [path.resolve(import.meta.dirname, "../../terminal/src/main.ts"), "mcp", "--run", token],
            env: { APX_URL: selfUrl, ...(config.token ? { APX_TOKEN: config.token } : {}) },
          },
        });
      } finally {
        gates.delete(token);
      }
    });
  const runner = createRunner({ store, broker, llm, log, engines, external });
  const runGate = (token: string) => {
    const g = gates.get(token);
    if (!g) throw new CallError({ code: "unauthorized", message: "unknown or finished run" });
    return g;
  };

  const dispatch = createRouter(
    {
      ...systemHandlers(identity, () => ({
        protocol: { status: "ok" },
        browser: broker.withCap(BROWSER_CAP)
          ? { status: "ok", detail: broker.withCap(BROWSER_CAP)?.name ?? "" }
          : { status: "off", detail: "no desktop node connected" },
        agent: { status: "ok", detail: llm.label },
      })),
      ...browserHandlers(broker),
      ...appHandlers(store, runner),
      "engines.status": async ({ refresh }) => ({ engines: await engines.status(refresh) }),
      "engines.set_default": async ({ engine }) => {
        engines.setDefault(engine);
        return { engines: await engines.status() };
      },
      "harness.tools": ({ token }) => ({
        tools: runGate(token).tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }),
      "harness.call": ({ token, tool, args }) => runGate(token).runTool(tool, args),
    },
    { get: store.idemGet, put: store.idemPut },
  );

  const gate: Gate = {
    allowedOrigins: originsFor(`http://${config.host}:${config.port || 7440}`, process.env.APX_ALLOWED_ORIGINS),
    token: config.token,
  };
  const server = http.createServer(
    httpHandler(dispatch, log, gate, opts.webDist ?? process.env.APX_WEB_DIST ?? defaultWebDist(), {
      artifact: (t) => {
        const s = store.surfaceByShareToken(t);
        return s ? { title: s.title, html: s.html } : undefined;
      },
    }),
  );
  const wss = attachWs(server, { dispatch, identity, log, broker, bus, gate });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://${config.host}:${port}`;
  selfUrl = url;
  log.info({ url, code_sha: identity.code_sha, home: config.home, llm: llm.label }, "apx core listening");

  return {
    url,
    identity,
    dispatch,
    broker,
    store,
    bus,
    gates: { open: openGate, close: (token: string) => gates.delete(token) },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
