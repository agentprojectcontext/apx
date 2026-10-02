// Pieces of the composition root, split out of createCore so each step reads on its own (rule 16).
// Still wiring only: no logic beyond passing dependencies along.

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { BROWSER_CAP } from "@apx/protocol";
import type { Bus } from "./bus.ts";
import type { CoreConfig } from "./config.ts";
import type { Store } from "./domain/store.ts";
import { audienceOf } from "./engine/audience.ts";
import { createHooks } from "./engine/hooks.ts";
import { createExtensions } from "./extensions/extensions.ts";
import { createPlugins } from "./extensions/plugins.ts";
import { acpAgents, acpEngine } from "./harness/acp/agents.ts";
import type { Identity } from "./identity.ts";
import type { Log } from "./log.ts";
import { refProblem } from "./models/choice.ts";
import type { NodeBroker } from "./nodes/broker.ts";
import { agentHandlers } from "./rpc/agents.ts";
import { appHandlers } from "./rpc/app.ts";
import { browserHandlers } from "./rpc/browser.ts";
import { channelHandlers } from "./rpc/channels.ts";
import { clientHandlers } from "./rpc/clients.ts";
import { composerHandlers } from "./rpc/composer.ts";
import { extensionHandlers } from "./rpc/extensions.ts";
import { fileHandlers } from "./rpc/files.ts";
import { jobHandlers } from "./rpc/jobs.ts";
import { mcpHandlers } from "./rpc/mcp.ts";
import { mediaHandlers } from "./rpc/media.ts";
import { memoryHandlers } from "./rpc/memory.ts";
import { notificationHandlers } from "./rpc/notifications.ts";
import { providerHandlers } from "./rpc/providers.ts";
import { resourceHandlers } from "./rpc/resources.ts";
import type { Dispatch } from "./rpc/router.ts";
import { routineHandlers } from "./rpc/routines.ts";
import { runHandlers } from "./rpc/runs.ts";
import { systemHandlers } from "./rpc/system.ts";
import { taskHandlers } from "./rpc/tasks.ts";
import { teamHandlers } from "./rpc/team.ts";
import { threadHandlers } from "./rpc/threads.ts";
import type { Secrets } from "./secrets.ts";
import { agentTools } from "./tools/agents.ts";
import { browserTools } from "./tools/browser.ts";
import { contactTools } from "./tools/contact.ts";
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

/** Engine ids a thread or agent may name: the CLI harnesses, every ACP agent, every configured provider. */
export function knownEngines(store: Store, providers: { has: (id: string) => boolean }) {
  const harnessEngines = () => ["claude", "codex", ...acpAgents(store).map(acpEngine)];
  return {
    harness: { has: (id: string) => harnessEngines().includes(id) },
    providers: { has: providers.has },
  };
}

/** Extensions and their plugin host. Copies changed on disk since approval are turned off at boot. */
export function extensionStack(d: { store: Store; secrets: Secrets; bus: Bus; log: Log; home: string }) {
  const hooks = createHooks();
  const plugins = createPlugins({
    home: d.home,
    secrets: d.secrets,
    bus: d.bus,
    hooks,
    log: d.log,
    approved: (id) => extensions.approved(id),
    sealed: (threadId) => {
      const t = d.store.threads.get(threadId);
      return Boolean(t && audienceOf(d.store, t).kind === "contact");
    },
  });
  const extensions = createExtensions({ store: d.store, secrets: d.secrets, home: d.home, plugins });
  const changed = extensions.verify();
  if (changed.length) d.log.warn({ extensions: changed }, "extensions changed on disk were turned off");
  return { hooks, plugins, extensions };
}

/** Every built-in tool, plus the ones a test adds. `port` is read late: tests listen on 0. */
export function builtinTools(store: Store, home: string, port: () => number, extra: Tool[] = []): Tool[] {
  return [
    ...agentTools(store),
    ...browserTools(),
    ...surfaceTools(),
    ...ownerTools(store),
    ...shellTools(store, home, port),
    ...skillTools(store, home),
    ...memoryTools(),
    ...mediaTools(),
    ...taskTools(),
    ...contactTools(store),
    ...extra,
  ];
}

type HandlerDeps = {
  store: Store;
  identity: Identity;
  broker: NodeBroker;
  llmLabel: () => string;
  engine: Parameters<typeof threadHandlers>[1] & Parameters<typeof jobHandlers>[1] & Parameters<typeof taskHandlers>[1];
  upkeep: Parameters<typeof threadHandlers>[2];
  memory: Parameters<typeof memoryHandlers>[1];
  channels: Parameters<typeof channelHandlers>[1];
  services: Parameters<typeof mediaHandlers>[0];
  scheduler: Parameters<typeof routineHandlers>[1];
  extensions: Parameters<typeof extensionHandlers>[0];
  mcp: Parameters<typeof extensionHandlers>[1] & Parameters<typeof mcpHandlers>[0];
  providers: Parameters<typeof providerHandlers>[0];
  secrets: Parameters<typeof providerHandlers>[1];
  app: Omit<Parameters<typeof appHandlers>[0], "store" | "secrets" | "services">;
  apc: Parameters<typeof agentHandlers>[1];
  templateRoots: Parameters<typeof teamHandlers>[2];
  engines: Parameters<typeof agentHandlers>[2];
};

/** The handler table the router serves: one entry per protocol method. */
export function coreHandlers(d: HandlerDeps) {
  return {
    ...systemHandlers(d.identity, () => ({
      protocol: { status: "ok" },
      browser: d.broker.withCap(BROWSER_CAP)
        ? { status: "ok", detail: d.broker.withCap(BROWSER_CAP)?.name ?? "" }
        : { status: "off", detail: "no desktop node connected" },
      agent: { status: "ok", detail: d.llmLabel() },
    })),
    ...browserHandlers(d.broker),
    ...threadHandlers(d.store, d.engine, d.upkeep),
    ...runHandlers(d.store, d.engine),
    ...jobHandlers(d.store, d.engine),
    ...memoryHandlers(d.store, d.memory),
    ...channelHandlers(d.store, d.channels),
    ...mediaHandlers(d.services),
    ...taskHandlers(d.store, d.engine),
    ...routineHandlers(d.store, d.scheduler),
    ...notificationHandlers(d.store),
    ...clientHandlers(d.store),
    ...extensionHandlers(d.extensions, d.mcp),
    ...mcpHandlers(d.mcp, d.store),
    ...resourceHandlers({ store: d.store, home: d.app.home, secrets: d.secrets, mcp: d.mcp.config }),
    ...providerHandlers(d.providers, d.secrets),
    ...appHandlers({ ...d.app, store: d.store, secrets: d.secrets, services: d.services }),
    ...agentHandlers(d.store, d.apc, d.engines),
    ...teamHandlers(d.store, d.apc, d.templateRoots),
    ...fileHandlers(d.store),
    ...composerHandlers({
      store: d.store,
      home: d.app.home,
      services: d.services,
      checkModel: (ref) => refProblem(ref, d.engines),
    }),
  };
}

/** The panel built by `pnpm --filter @apx/web build`, when present next to the core in the workspace. */
function workspaceWebDist(): string | undefined {
  const dist = path.resolve(import.meta.dirname, "../../web/dist");
  return fs.existsSync(path.join(dist, "index.html")) ? dist : undefined;
}

/** HTTP + WebSocket transports over one dispatcher; resolves once the port is bound. */
export async function listen(
  config: CoreConfig,
  d: { dispatch: Dispatch; store: Store; log: Log; identity: Identity; broker: NodeBroker; bus: Bus },
) {
  const gate: Gate = {
    allowedOrigins: originsFor(`http://${config.host}:${config.port || 7440}`, config.allowedOrigins),
    token: config.token,
  };
  const server = http.createServer(
    httpHandler(
      d.dispatch,
      d.log,
      gate,
      config.webDist ?? workspaceWebDist(),
      {
        artifact: (t) => {
          const s = d.store.surfaces.byShareToken(t);
          return s ? { title: s.title, html: s.html } : undefined;
        },
      },
      (token) => d.store.clients.byToken(token),
    ),
  );
  const wss = attachWs(server, {
    dispatch: d.dispatch,
    identity: d.identity,
    log: d.log,
    broker: d.broker,
    bus: d.bus,
    gate,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `http://${config.host}:${port}`,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
