// Composition root: config → identity → db/store → agent runner → router → transports.
// Tests call createCore directly (with a temp home and a fake LLM).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BROWSER_CAP } from "@apx/protocol";
import { createLlm, type Llm, llmConfigFromEnv } from "./agent/provider.ts";
import { createRunner } from "./agent/runner.ts";
import { createBus } from "./bus.ts";
import type { CoreConfig } from "./config.ts";
import { openDb } from "./db/db.ts";
import { seed } from "./domain/seed.ts";
import { createStore } from "./domain/store.ts";
import { readIdentity } from "./identity.ts";
import { createLog } from "./log.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { appHandlers } from "./rpc/app.ts";
import { browserHandlers } from "./rpc/browser.ts";
import { createRouter } from "./rpc/router.ts";
import { systemHandlers } from "./rpc/system.ts";
import { httpHandler } from "./transport/http.ts";
import { attachWs } from "./transport/ws.ts";

export async function createCore(config: CoreConfig, opts: { quiet?: boolean; llm?: Llm; webDist?: string } = {}) {
  const log = createLog("core", opts.quiet);
  const identity = readIdentity(config.home);
  const db = openDb(config.home);
  const bus = createBus();
  const store = createStore(db, bus);
  seed(store);
  const orphaned = store.failOrphanRuns();
  if (orphaned) log.warn({ orphaned }, "marked runs interrupted by the last restart as failed");

  const broker = createNodeBroker();
  broker.onEvent((_node, event) => {
    if (event.type === "tabs.changed")
      bus.emit({ type: "browser.tabs", tabs: (event.payload as { tabs: unknown[] }).tabs ?? [] });
  });
  const llm = opts.llm ?? createLlm(llmConfigFromEnv());
  const runner = createRunner({ store, broker, llm, log });

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
    },
    { get: store.idemGet, put: store.idemPut },
  );

  const server = http.createServer(httpHandler(dispatch, log, config.token, opts.webDist ?? process.env.APX_WEB_DIST));
  const wss = attachWs(server, { dispatch, identity, log, broker, bus });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://${config.host}:${port}`;
  log.info({ url, code_sha: identity.code_sha, home: config.home, llm: llm.label }, "apx core listening");

  return {
    url,
    identity,
    dispatch,
    broker,
    store,
    bus,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
