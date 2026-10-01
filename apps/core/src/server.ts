// Composition root: wires config → identity → router → transports. Tests call createCore directly.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BROWSER_CAP } from "@apx/protocol";
import type { CoreConfig } from "./config.ts";
import { readIdentity } from "./identity.ts";
import { createLog } from "./log.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { browserHandlers } from "./rpc/browser.ts";
import { createRouter } from "./rpc/router.ts";
import { systemHandlers } from "./rpc/system.ts";
import { httpHandler } from "./transport/http.ts";
import { attachWs } from "./transport/ws.ts";

export async function createCore(config: CoreConfig, opts: { quiet?: boolean } = {}) {
  const log = createLog("core", opts.quiet);
  const identity = readIdentity(config.home);
  const broker = createNodeBroker();
  const dispatch = createRouter({
    ...systemHandlers(identity, () => ({
      protocol: { status: "ok" },
      browser: broker.withCap(BROWSER_CAP)
        ? { status: "ok", detail: broker.withCap(BROWSER_CAP)?.name ?? "" }
        : { status: "off", detail: "no desktop node connected" },
    })),
    ...browserHandlers(broker),
  });

  const server = http.createServer(httpHandler(dispatch, log, config.token));
  const wss = attachWs(server, { dispatch, identity, log, broker });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://${config.host}:${port}`;
  log.info({ url, code_sha: identity.code_sha, home: config.home }, "apx core listening");

  return {
    url,
    identity,
    dispatch,
    broker,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
