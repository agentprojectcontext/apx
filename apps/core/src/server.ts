// Composition root: config → identity → db/store → providers → harnesses → engine → router → transports.
// Only wiring lives here. Tests call createCore directly (with a temp home and fakes).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { BROWSER_CAP, type HarnessId } from "@apx/protocol";
import { createApcSync } from "./apc/sync.ts";
import { createBus } from "./bus.ts";
import { createChannels } from "./channels/manager.ts";
import { telegramAdapter } from "./channels/telegram.ts";
import type { AdapterFactory } from "./channels/types.ts";
import type { CoreConfig } from "./config.ts";
import { openDb } from "./db/db.ts";
import { seed } from "./domain/seed.ts";
import { createStore } from "./domain/store.ts";
import { createEngine } from "./engine/engine.ts";
import { createMemoryIndex } from "./engine/memory-index.ts";
import { afterTaskTurn } from "./engine/office.ts";
import type { ToolCall } from "./engine/turn.ts";
import { createUpkeep } from "./engine/upkeep.ts";
import { acpAgents, acpEngine } from "./harness/acp/agents.ts";
import { createHarnesses, type Harness } from "./harness/index.ts";
import { readIdentity } from "./identity.ts";
import { createLog } from "./log.ts";
import { createMcp } from "./mcp/manager.ts";
import { createCatalog } from "./models/catalog.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { createLlm, type Llm } from "./providers/llm.ts";
import { providerRegistry } from "./providers/registry.ts";
import { agentHandlers } from "./rpc/agents.ts";
import { appHandlers } from "./rpc/app.ts";
import { browserHandlers } from "./rpc/browser.ts";
import { channelHandlers } from "./rpc/channels.ts";
import { internalCaller } from "./rpc/internal.ts";
import { jobHandlers } from "./rpc/jobs.ts";
import { mcpHandlers } from "./rpc/mcp.ts";
import { mediaHandlers } from "./rpc/media.ts";
import { memoryHandlers } from "./rpc/memory.ts";
import { providerHandlers } from "./rpc/providers.ts";
import { createRouter, type Dispatch } from "./rpc/router.ts";
import { systemHandlers } from "./rpc/system.ts";
import { taskHandlers } from "./rpc/tasks.ts";
import { threadHandlers } from "./rpc/threads.ts";
import { createSecrets } from "./secrets.ts";
import { createServices } from "./services/registry.ts";
import { agentTools } from "./tools/agents.ts";
import { browserTools } from "./tools/browser.ts";
import { mediaTools } from "./tools/media.ts";
import { memoryTools } from "./tools/memory.ts";
import { ownerTools } from "./tools/owner.ts";
import { shellTools } from "./tools/shell.ts";
import { skillTools } from "./tools/skills.ts";
import { surfaceTools } from "./tools/surfaces.ts";
import { taskTools } from "./tools/tasks.ts";
import type { Tool } from "./tools/types.ts";
import { type Gate, originsFor } from "./transport/guard.ts";
import { httpHandler } from "./transport/http.ts";
import { attachWs } from "./transport/ws.ts";

/** The panel built by `pnpm --filter @apx/web build`, when present next to the core in the workspace. */
function workspaceWebDist(): string | undefined {
  const dist = path.resolve(import.meta.dirname, "../../web/dist");
  return fs.existsSync(path.join(dist, "index.html")) ? dist : undefined;
}

/** `apx2 mcp --run` (token in APX_RUN_TOKEN): how an external harness (Codex) reaches the tools of its run. */
const TERMINAL_MAIN = path.resolve(import.meta.dirname, "../../terminal/src/main.ts");

export async function createCore(
  config: CoreConfig,
  opts: {
    quiet?: boolean;
    llm?: Llm;
    harnesses?: Partial<Record<HarnessId, Harness>>;
    /** Tests add tools of their own next to the built-in ones. */
    extraTools?: Tool[];
    /** Channel adapters by type; tests use a fake one instead of Telegram. */
    channelAdapters?: Record<string, AdapterFactory>;
  } = {},
) {
  const log = createLog("core", opts.quiet);
  const identity = readIdentity(config.home);
  const db = openDb(config.home);
  const bus = createBus();
  const store = createStore(db, bus);
  const secrets = createSecrets(config.home, config.secrets);
  seed(store);
  store.idempotency.prune();

  const broker = createNodeBroker();
  broker.onEvent((_node, event) => {
    if (event.type === "tabs.changed")
      bus.emit({ type: "browser.tabs", tabs: (event.payload as { tabs: unknown[] }).tabs ?? [] });
  });

  let selfUrl = "";
  const providers = providerRegistry(store, config.providers);
  const llm = opts.llm ?? createLlm({ providers: providers.active, secrets, firstByteMs: config.llmTimeoutMs });
  const harnesses = createHarnesses({
    store,
    llm,
    home: config.home,
    mcpProxy: () => ({
      command: process.execPath,
      args: [TERMINAL_MAIN, "mcp", "--run"],
      env: { APX_URL: selfUrl, ...(config.token ? { APX_TOKEN: config.token } : {}) },
    }),
    ...(opts.harnesses ? { overrides: opts.harnesses } : {}),
  });
  const catalog = createCatalog({ store, secrets, providers: providers.active, home: config.home });
  const harnessEngines = () => ["claude", "codex", ...acpAgents(store).map(acpEngine)];
  const engineIds = {
    harness: { has: (id: string) => harnessEngines().includes(id) },
    providers: { has: providers.has },
  };
  const apc = createApcSync({
    store,
    log,
    // Live: an ACP agent or a provider added later is recognized without a restart.
    engines: { has: (id) => harnessEngines().includes(id) || providers.has(id) },
  });
  apc.sync();
  // The port this core answers on: the configured one, or the one the OS gave (tests listen on 0).
  let listening = config.port || 7440;
  const tools = [
    ...agentTools(store),
    ...browserTools(),
    ...surfaceTools(),
    ...ownerTools(store),
    ...shellTools(store, config.home, () => listening),
    ...skillTools(store, config.home),
    ...memoryTools(),
    ...mediaTools(),
    ...taskTools(),
    ...(opts.extraTools ?? []),
  ];
  // Tools reach the core through the router like any client, as the agent (owner-only methods refuse them).
  // The router exists only after the engine, hence the late binding.
  let routed: Dispatch | undefined;
  const internal = internalCaller(() => routed, log);
  const call: ToolCall = (method, params, as) =>
    internal(
      method,
      params,
      { actor: "agent", agent: { id: as.run.agent_id, run_id: as.run.id, thread_id: as.run.thread_id } },
      `tool:${as.run.id}:${as.callId}:${randomUUID()}`,
    );
  const mcp = createMcp({ store, secrets, log });
  const upkeep = createUpkeep({ store, llm, log });
  const services = createServices({ store, secrets, home: config.home, log });
  const memory = createMemoryIndex({ store, services, log });
  const channels = createChannels({
    store,
    secrets,
    bus,
    log,
    factories: opts.channelAdapters ?? { telegram: telegramAdapter },
    call: internal,
    services,
  });
  const engine = createEngine({
    store,
    harnesses,
    tools,
    log,
    call,
    home: config.home,
    apxPort: () => listening,
    memory,
    mcpTools: mcp.toolsFor,
    afterRun: (run) => {
      upkeep.afterRun(run);
      channels.afterRun(run);
      afterTaskTurn(store, engine.admit, run);
    },
  });

  const dispatch = createRouter(
    {
      ...systemHandlers(identity, () => ({
        protocol: { status: "ok" },
        browser: broker.withCap(BROWSER_CAP)
          ? { status: "ok", detail: broker.withCap(BROWSER_CAP)?.name ?? "" }
          : { status: "off", detail: "no desktop node connected" },
        agent: { status: "ok", detail: llm.label() },
      })),
      ...browserHandlers(broker),
      ...threadHandlers(store, engine, upkeep),
      ...jobHandlers(store, engine),
      ...memoryHandlers(store, memory),
      ...channelHandlers(store, channels),
      ...mediaHandlers(services),
      ...taskHandlers(store, engine),
      ...mcpHandlers(mcp),
      ...providerHandlers(providers, secrets),
      ...appHandlers({
        store,
        harnesses,
        secrets,
        v1: config.v1,
        catalog,
        apc,
        engines: engineIds,
        home: config.home,
        services,
      }),
      ...agentHandlers(store, apc, engineIds),
    },
    store.idempotency,
  );
  routed = dispatch;

  const gate: Gate = {
    allowedOrigins: originsFor(`http://${config.host}:${config.port || 7440}`, config.allowedOrigins),
    token: config.token,
  };
  const server = http.createServer(
    httpHandler(dispatch, log, gate, config.webDist ?? workspaceWebDist(), {
      artifact: (t) => {
        const s = store.surfaces.byShareToken(t);
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
  listening = port;
  const url = `http://${config.host}:${port}`;
  selfUrl = url;
  engine.start();
  await channels.start();
  log.info({ url, code_sha: identity.code_sha, home: config.home, llm: llm.label() }, "apx core listening");

  return {
    url,
    identity,
    dispatch,
    broker,
    store,
    bus,
    engine,
    harnesses,
    secrets,
    channels,
    async close() {
      await channels.stop();
      await engine.stop();
      await upkeep.stop();
      await mcp.close();
      apc.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
