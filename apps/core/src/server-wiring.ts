// Pieces of the composition root, split out of createCore so each step reads on its own (rule 16).
// Still wiring only: no logic beyond passing dependencies along.

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { BROWSER_CAP } from "@apx/protocol";
import type { Bus } from "./bus.ts";
import type { CoreConfig } from "./config.ts";
import { nativeApproval } from "./domain/approvals.ts";
import type { Store } from "./domain/store.ts";
import { audienceOf } from "./engine/audience.ts";
import { createHooks } from "./engine/hooks.ts";
import type { Permissions } from "./engine/permissions.ts";
import { applyProfile, listProfiles, type ProfileRoot } from "./engine/profiles.ts";
import type { Upkeep } from "./engine/upkeep.ts";
import { errorMessage } from "./errors.ts";
import { createExtensions } from "./extensions/extensions.ts";
import { createPlugins } from "./extensions/plugins.ts";
import { acpAgents, acpEngine } from "./harness/acp/agents.ts";
import type { Identity } from "./identity.ts";
import type { Asana } from "./integrations/asana.ts";
import { isGoogleId } from "./integrations/catalog.ts";
import type { Google } from "./integrations/google.ts";
import type { Log } from "./log.ts";
import { refProblem } from "./models/choice.ts";
import type { NodeBroker } from "./nodes/broker.ts";
import type { HeadlessBrowser } from "./nodes/headless-browser.ts";
import { findProgram } from "./programs.ts";
import { accessHandlers } from "./rpc/access.ts";
import { agentHandlers } from "./rpc/agents.ts";
import { appHandlers } from "./rpc/app.ts";
import { asanaHandlers } from "./rpc/asana.ts";
import { browserHandlers } from "./rpc/browser.ts";
import { channelHandlers } from "./rpc/channels.ts";
import { clientHandlers } from "./rpc/clients.ts";
import { composerHandlers } from "./rpc/composer.ts";
import { computerHandlers } from "./rpc/computer.ts";
import { desktopInstallHandlers } from "./rpc/desktop-install.ts";
import { deviceHandlers } from "./rpc/devices.ts";
import { embeddingHandlers } from "./rpc/embeddings.ts";
import { extensionHandlers } from "./rpc/extensions.ts";
import { fileHandlers } from "./rpc/files.ts";
import { gitHandlers } from "./rpc/git.ts";
import { integrationHandlers } from "./rpc/integrations.ts";
import type { InternalCall } from "./rpc/internal.ts";
import { jobHandlers } from "./rpc/jobs.ts";
import { mcpHandlers } from "./rpc/mcp.ts";
import { mediaHandlers } from "./rpc/media.ts";
import { memoryHandlers } from "./rpc/memory.ts";
import { noticeHandlers } from "./rpc/notices.ts";
import { notificationHandlers } from "./rpc/notifications.ts";
import { phoneHandlers } from "./rpc/phone.ts";
import { providerHandlers } from "./rpc/providers.ts";
import { resourceHandlers } from "./rpc/resources.ts";
import type { Dispatch } from "./rpc/router.ts";
import { routineHandlers } from "./rpc/routines.ts";
import { runHandlers } from "./rpc/runs.ts";
import { sessionHandlers } from "./rpc/sessions.ts";
import { setupHandlers } from "./rpc/setup.ts";
import { artifactHandlers } from "./rpc/surfaces.ts";
import { newsHandlers, systemHandlers, telemetryHandlers, updateHandlers } from "./rpc/system.ts";
import { taskHandlers } from "./rpc/tasks.ts";
import { teamHandlers } from "./rpc/team.ts";
import { terminalHandlers } from "./rpc/terminal.ts";
import { threadAdminHandlers } from "./rpc/thread-admin.ts";
import { threadHandlers } from "./rpc/threads.ts";
import { transcriptionHandlers } from "./rpc/transcription.ts";
import { webhookHandlers } from "./rpc/webhooks.ts";
import type { Secrets } from "./secrets.ts";
import type { RuntimeHomes } from "./skills/runtimes.ts";
import { kitSource, withKit } from "./surface-kit.ts";
import type { Telemetry } from "./telemetry.ts";
import { agentSetTools } from "./tools/agent-set.ts";
import { agentTools } from "./tools/agents.ts";
import { browserTools } from "./tools/browser.ts";
import { chatTools } from "./tools/chats.ts";
import { computerTools } from "./tools/computer.ts";
import { connectionTools } from "./tools/connections.ts";
import { contactTools } from "./tools/contact.ts";
import { directoryTools } from "./tools/directory.ts";
import { fileTools } from "./tools/files.ts";
import { limitTools } from "./tools/limits.ts";
import { mediaTools } from "./tools/media.ts";
import { memoryTools } from "./tools/memory.ts";
import { messageTools } from "./tools/message.ts";
import { ownerTools } from "./tools/owner.ts";
import { phoneTools } from "./tools/phone.ts";
import { requestTools } from "./tools/requests.ts";
import { routineTools } from "./tools/routines.ts";
import { settingsTools } from "./tools/settings.ts";
import { shellTools } from "./tools/shell.ts";
import { skillTools } from "./tools/skills.ts";
import { surfaceTools } from "./tools/surfaces.ts";
import { taskTools } from "./tools/tasks.ts";
import type { Tool } from "./tools/types.ts";
import { videoTools } from "./tools/video.ts";
import { webTools } from "./tools/web.ts";
import { type Gate, originsFor } from "./transport/guard.ts";
import { httpHandler } from "./transport/http.ts";
import { attachWs } from "./transport/ws.ts";
import type { Updates } from "./updates.ts";

// Not `import http from "node:http"`: that loads Node's fetch client (undici), which an idle core never uses.
// See HISTORY.md#esm-node-http.
const http = process.getBuiltinModule("node:http");

/** Engine ids a thread or agent may name: the CLI harnesses, every ACP agent, every configured provider. */
export function knownEngines(store: Store, providers: { has: (id: string) => boolean }) {
  const harnessEngines = () => ["claude", "codex", "aider", "antigravity", ...acpAgents(store).map(acpEngine)];
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
export function builtinTools(
  store: Store,
  home: string,
  port: () => number,
  extra: Tool[] = [],
  /** The other agent apps whose skills agents may load too. */
  skillApps?: RuntimeHomes,
  /** Where agent profiles and agent templates are found, for the super-agent's settings. */
  roots?: Parameters<typeof settingsTools>[1],
): Tool[] {
  const tools = [
    ...agentTools(store),
    ...agentSetTools(store),
    ...chatTools(store),
    ...browserTools(store, home),
    ...surfaceTools(store, home),
    ...ownerTools(store),
    ...connectionTools(),
    ...shellTools(store, home, port),
    ...fileTools(store, home),
    ...messageTools(store, home),
    ...directoryTools(store),
    ...routineTools(store),
    ...limitTools(store),
    ...skillTools(store, { home, apps: skillApps }),
    ...memoryTools(store),
    ...mediaTools(store, home),
    ...phoneTools(),
    ...computerTools(store),
    ...taskTools(store),
    ...videoTools(findProgram("yt-dlp")),
    ...webTools(),
    ...contactTools(store),
    ...requestTools(store),
    ...settingsTools(store, roots),
    ...extra,
  ];
  // The owner may let an agent use one of them without asking again, as with an MCP tool (DECISIONS.md#d-062).
  return tools.map((t) => (t.approval ? t : { ...t, approval: nativeApproval(t.name) }));
}

type HandlerDeps = {
  store: Store;
  /** How agents act and how far their files reach (engine/permissions.ts). */
  permissions: Permissions;
  /** The router from inside the core (late-bound: it exists once these handlers do). */
  internal: InternalCall;
  log: Log;
  identity: Identity;
  broker: NodeBroker;
  headless: HeadlessBrowser | undefined;
  /** Turns ending let go of the browser tabs they held. */
  bus: Bus;
  llmLabel: () => string;
  engine: Parameters<typeof threadHandlers>[1] & Parameters<typeof jobHandlers>[1] & Parameters<typeof taskHandlers>[1];
  upkeep: Parameters<typeof threadHandlers>[2] & Parameters<typeof gitHandlers>[1] & Pick<Upkeep, "study">;
  memory: Parameters<typeof memoryHandlers>[1];
  memoryMaintenance: NonNullable<Parameters<typeof memoryHandlers>[2]>;
  channels: Parameters<typeof channelHandlers>[1];
  services: Parameters<typeof mediaHandlers>[0];
  scheduler: Parameters<typeof routineHandlers>[1];
  nudges: Parameters<typeof noticeHandlers>[1];
  extensions: Parameters<typeof extensionHandlers>[0];
  mcp: Parameters<typeof extensionHandlers>[1] & Parameters<typeof mcpHandlers>[0];
  /** The owner's Google account (Calendar, Gmail). */
  google: Google;
  asana: Asana;
  providers: Parameters<typeof providerHandlers>[0];
  secrets: Parameters<typeof providerHandlers>[1];
  chatgpt: Parameters<typeof providerHandlers>[2];
  localModels: Parameters<typeof transcriptionHandlers>[1];
  localEmbeds: Parameters<typeof embeddingHandlers>[0];
  app: Omit<Parameters<typeof appHandlers>[0], "store" | "secrets" | "services">;
  apc: Parameters<typeof agentHandlers>[1];
  templateRoots: Parameters<typeof teamHandlers>[2];
  /** Where profiles are found: APX's own, then the owner's installed ones. */
  profileRoots: readonly ProfileRoot[];
  engines: Parameters<typeof agentHandlers>[2];
  /** Every built-in tool: what an agent's editor offers. */
  tools: Parameters<typeof agentHandlers>[3];
  desktop: Parameters<typeof fileHandlers>[1];
  desktopInstaller: Parameters<typeof desktopInstallHandlers>[0];
  /** Where Claude Code and Codex keep the owner's own sessions. */
  native: Parameters<typeof sessionHandlers>[1];
  /** Other agent apps' folders that get APX's skills for them. */
  runtimeHomes: Parameters<typeof resourceHandlers>[0]["runtimeHomes"];
  updates: Updates;
  telemetry: Telemetry;
  /** Release news the super-agent tells. */
  news: Parameters<typeof newsHandlers>[0];
  /** The panel build being served (its entry file). */
  panel: () => string | undefined;
  /** The addresses a paired device may reach this core on. */
  addresses: () => string[];
  /** Who may reach this core (this computer, the network, the tailnet). */
  access: Parameters<typeof accessHandlers>[0];
  webhooks: Parameters<typeof webhookHandlers>[0];
  /** What asks an integration's remote server about the owner's account (tests pass a fake). */
  integrationFetch?: typeof fetch | undefined;
  /** The owner's shells in a chat's folder. */
  terminals: Parameters<typeof terminalHandlers>[1];
};

/** The handler table the router serves: one entry per protocol method. */
export function coreHandlers(d: HandlerDeps) {
  return {
    ...desktopInstallHandlers(d.desktopInstaller),
    ...updateHandlers(d.updates),
    ...telemetryHandlers(d.telemetry),
    ...newsHandlers(d.news),
    ...systemHandlers(d.identity, d.app.home, d.panel, () => ({
      protocol: { status: "ok" },
      browser: d.broker.withCap(BROWSER_CAP)
        ? { status: "ok", detail: d.broker.withCap(BROWSER_CAP)?.name ?? "" }
        : d.headless?.available()
          ? { status: "ok", detail: "headless Chrome (no desktop app connected)" }
          : { status: "off", detail: "no desktop node connected" },
      agent: { status: "ok", detail: d.llmLabel() },
    })),
    ...browserHandlers(d.broker, d.headless, d.bus),
    ...threadHandlers(d.store, d.engine, d.upkeep),
    ...threadAdminHandlers(d.store, d.app.home),
    ...runHandlers(d.store, d.engine),
    ...jobHandlers(d.store, d.engine),
    ...memoryHandlers(d.store, d.memory, d.memoryMaintenance),
    ...channelHandlers(d.store, d.channels),
    ...mediaHandlers(d.services),
    ...transcriptionHandlers(d.services, d.localModels),
    ...embeddingHandlers(d.localEmbeds, () => d.memory.engine()),
    ...taskHandlers(d.store, d.engine, d.app.home),
    ...routineHandlers(d.store, d.scheduler, d.profileRoots),
    ...noticeHandlers(d.store, d.nudges),
    ...notificationHandlers(d.store),
    ...clientHandlers(d.store),
    ...deviceHandlers(d.store, { addresses: d.addresses }),
    ...accessHandlers(d.access),
    ...webhookHandlers(d.webhooks),
    ...phoneHandlers(d.broker, d.store, d.app.home),
    ...computerHandlers(d.broker, d.store, d.app.home, d.engine),
    ...extensionHandlers(d.extensions, d.mcp),
    // Native integrations share the project switches of global servers, without starting an MCP.
    ...mcpHandlers(d.mcp, d.store, (name) =>
      name === "asana" ? d.asana.connected() : isGoogleId(name) && d.google.connected(name),
    ),
    ...integrationHandlers({
      store: d.store,
      secrets: d.secrets,
      mcp: d.mcp,
      google: d.google,
      asana: d.asana,
      ...(d.integrationFetch ? { fetch: d.integrationFetch } : {}),
    }),
    ...asanaHandlers(d.store, d.asana),
    ...resourceHandlers({
      store: d.store,
      home: d.app.home,
      secrets: d.secrets,
      mcp: d.mcp.config,
      runtimeHomes: d.runtimeHomes,
    }),
    ...providerHandlers(d.providers, d.secrets, d.chatgpt),
    ...appHandlers({ ...d.app, store: d.store, secrets: d.secrets, services: d.services }),
    ...artifactHandlers({
      store: d.store,
      secrets: d.secrets,
      home: d.app.home,
      checkPage: d.headless?.available()
        ? (html, onCall) => d.headless?.checkPage(html, onCall) ?? Promise.resolve({ errors: [], text: "", views: [] })
        : undefined,
    }),
    ...agentHandlers(d.store, d.apc, d.engines, d.tools),
    ...teamHandlers(d.store, d.apc, d.templateRoots, (s) => d.scheduler.nextFor(s)),
    ...fileHandlers(d.store, d.desktop, d.app.home),
    ...gitHandlers(d.store, d.upkeep),
    ...terminalHandlers(d.store, d.terminals, d.app.home),
    ...sessionHandlers(d.store, d.native, {
      home: d.app.home,
      apc: d.apc,
      ask: (agent, about, system, user) => d.upkeep.study(agent, system, user, about),
      call: d.internal,
    }),
    ...setupHandlers({
      store: d.store,
      apc: d.apc,
      secrets: d.secrets,
      channels: d.channels,
      services: d.services,
      providers: d.providers,
      runProfile: (id, values) => {
        const manifest = listProfiles(d.profileRoots).find((p) => p.id === id);
        if (!manifest) return false;
        const lang = d.store.settings.get("owner_language") || "es";
        applyProfile(d.store, { manifest, values, lang, nextFor: (s) => d.scheduler.nextFor(s) });
        return true;
      },
      reindex: () => {
        void d.memory.index().catch((err) => d.log.warn({ err: errorMessage(err, 200) }, "memory indexing failed"));
      },
      v1Home: d.app.v1.home,
      v1Url: d.app.v1.url,
      v2Home: d.app.home,
    }),
    ...composerHandlers({
      store: d.store,
      home: d.app.home,
      scopeOf: (caller) => d.permissions.forCaller(caller),
      locate: (thread, file) => d.permissions.path(thread, file),
      services: d.services,
      checkModel: (ref, session) => refProblem(ref, d.engines, session),
    }),
  };
}

/** The panel built by `pnpm --filter @apx/web build`, when present next to the core in the workspace. */
function workspaceWebDist(): string | undefined {
  const dist = path.resolve(import.meta.dirname, "../../web/dist");
  return fs.existsSync(path.join(dist, "index.html")) ? dist : undefined;
}

/** The panel folder the core serves: the configured one, or the workspace build. */
export const servedPanel = (config: CoreConfig) => config.webDist ?? workspaceWebDist();

let entryCache: { at: number; entry: string | undefined } | undefined;
/** The served panel's entry script (hashed per build), read again only when index.html changes. */
export function panelEntry(dist: string | undefined): string | undefined {
  if (!dist) return undefined;
  try {
    const file = path.join(dist, "index.html");
    const at = fs.statSync(file).mtimeMs;
    if (entryCache?.at !== at)
      entryCache = { at, entry: /src="[^"]*\/(index-[\w-]+\.js)"/.exec(fs.readFileSync(file, "utf8"))?.[1] };
    return entryCache.entry;
  } catch {
    return undefined;
  }
}

/**
 * Where a device on the network may reach this core: none while it listens only on this computer; each of the machine's
 * network addresses (LAN, Tailscale) when it listens on all of them.
 */
export function reachableAt(host: string, port: number, publicUrl?: string): string[] {
  const own = publicUrl ? [publicUrl] : [];
  return [...own, ...networkAddresses(host, port).filter((u) => u !== publicUrl)];
}

function networkAddresses(host: string, port: number): string[] {
  if (LOOPBACK_HOSTS.has(host)) return [];
  if (host !== "0.0.0.0" && host !== "::") return [`http://${host.includes(":") ? `[${host}]` : host}:${port}`];
  return Object.values(os.networkInterfaces())
    .flat()
    .flatMap((a) => (a && !a.internal && a.family === "IPv4" ? [`http://${a.address}:${port}`] : []));
}
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** The panel may also be opened at the public URL (a Tailscale name) or at any address the core is reachable on. */
export function exposedOrigins(config: Pick<CoreConfig, "host" | "publicUrl">, port: number): string[] {
  const origins = new Set<string>();
  for (const u of reachableAt(config.host, port, config.publicUrl)) {
    try {
      origins.add(new URL(u).origin);
    } catch {
      // A malformed APX_PUBLIC_URL allows nothing extra.
    }
  }
  return [...origins];
}

/** How long the core keeps an idle HTTP connection open for its next request. */
export const KEEP_ALIVE_MS = 65_000;

/** HTTP + WebSocket transports over one dispatcher; resolves once the port is bound. */
export async function listen(
  config: CoreConfig,
  d: { dispatch: Dispatch; store: Store; log: Log; identity: Identity; broker: NodeBroker; bus: Bus },
) {
  const allowedOrigins = originsFor(`http://${config.host}:${config.port || 7440}`, config.allowedOrigins);
  const gate: Gate = {
    allowedOrigins,
    token: config.token,
    device: (token) => Boolean(d.store.devices.byToken(token)),
  };
  const server = http.createServer(
    httpHandler(
      d.dispatch,
      d.log,
      gate,
      servedPanel(config),
      {
        artifact: (t) => {
          const s = d.store.surfaces.byShareToken(t);
          return s ? { title: s.title, html: withKit(s.html), app: s.app, connect: s.connect } : undefined;
        },
        kit: kitSource,
      },
      (token) => d.store.clients.byToken(token),
      (token) => d.store.devices.byToken(token),
    ),
  );
  // Idle connections stay open far longer than a client reuses one (fetch: about 4 s), so a client never reuses a
  // connection the core is closing; Node's 5 s default reset calls after a stall. See HISTORY.md#loopback-keep-alive.
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1000;
  const wss = attachWs(server, {
    dispatch: d.dispatch,
    identity: d.identity,
    log: d.log,
    broker: d.broker,
    bus: d.bus,
    gate,
    deviceOf: (token) => d.store.devices.byToken(token),
    clientOf: (token) => d.store.clients.byToken(token),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  // Known once bound: a test or an APX_PORT=0 core only learns its port here.
  for (const o of exposedOrigins(config, port)) allowedOrigins.add(o);
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
