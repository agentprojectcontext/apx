// Composition root: config → identity → db/store → providers → harnesses → engine → router → transports.
// Only wiring lives here. Tests call createCore directly (with a temp home and fakes).

import { randomUUID } from "node:crypto";
import path from "node:path";
import { BROWSER_CAP, type HarnessId, TabInfo } from "@apx/protocol";
import { createAccess } from "./access.ts";
import { createApcSync } from "./apc/sync.ts";
import { createBus } from "./bus.ts";
import { discordAdapter } from "./channels/discord.ts";
import { emailAdapter } from "./channels/email.ts";
import { createChannels } from "./channels/manager.ts";
import { matrixAdapter } from "./channels/matrix.ts";
import { mattermostAdapter } from "./channels/mattermost.ts";
import { signalAdapter } from "./channels/signal.ts";
import { slackAdapter } from "./channels/slack.ts";
import { telegramAdapter } from "./channels/telegram.ts";
import type { AdapterFactory } from "./channels/types.ts";
import { whatsappAdapter } from "./channels/whatsapp.ts";
import { type CoreConfig, OAUTH_CHATGPT } from "./config.ts";
import { openDb } from "./db/db.ts";
import { type DesktopOps, systemDesktop } from "./desktop.ts";
import { seed } from "./domain/seed.ts";
import { createStore } from "./domain/store.ts";
import { createAttention } from "./engine/attention.ts";
import { createEngine } from "./engine/engine.ts";
import type { InputWaits } from "./engine/inputs.ts";
import { createMemoryIndex } from "./engine/memory-index.ts";
import { createNoticePush } from "./engine/notice-push.ts";
import type { ProfileRoot } from "./engine/profiles.ts";
import { createSkillPicker } from "./engine/skill-pick.ts";
import { afterWorkTurn } from "./engine/task-work.ts";
import { wakeAfterCommand } from "./engine/terminal-wake.ts";
import type { ToolCall } from "./engine/turn.ts";
import { createUpkeep } from "./engine/upkeep.ts";
import { errorMessage } from "./errors.ts";
import { createHarnesses, type Harness } from "./harness/index.ts";
import { readIdentity } from "./identity.ts";
import { type IMessageOps, systemIMessage } from "./imessage.ts";
import { createGoogle } from "./integrations/google.ts";
import { GOOGLE, googleAt } from "./integrations/google-oauth.ts";
import { createLog, type Log } from "./log.ts";
import { mcpConfig } from "./mcp/config.ts";
import { createMcp } from "./mcp/manager.ts";
import { createCatalog } from "./models/catalog.ts";
import { nodeChildEnv } from "./node-runtime.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { createHeadlessBrowser } from "./nodes/headless-browser.ts";
import { officeScheduler } from "./office-wiring.ts";
import { createChatgptLogin } from "./providers/chatgpt-login.ts";
import { createLlm, type Llm } from "./providers/llm.ts";
import { providerRegistry } from "./providers/registry.ts";
import { internalCaller } from "./rpc/internal.ts";
import { createRouter, type Dispatch } from "./rpc/router.ts";
import { useLocalModel } from "./rpc/transcription.ts";
import { createSecrets } from "./secrets.ts";
import {
  builtinTools,
  coreHandlers,
  extensionStack,
  knownEngines,
  listen,
  panelEntry,
  reachableAt,
  servedPanel,
} from "./server-wiring.ts";
import { createModelInstaller } from "./services/local-whisper.ts";
import { createPush } from "./services/push.ts";
import { createServices } from "./services/registry.ts";
import { mediaData } from "./services/uploads.ts";
import { syncRuntimeSkills } from "./skills/runtimes.ts";
import { skillsFor } from "./skills/skills.ts";
import { createTerminals } from "./terminal/terminals.ts";
import { googleTools } from "./tools/google.ts";
import { imessageTools } from "./tools/imessage.ts";
import type { Tool } from "./tools/types.ts";
import { createUpdates, type Runner } from "./updates.ts";

/** `apx mcp --run` (token in APX_RUN_TOKEN): how an external harness (Codex) reaches the tools of its run. */
const TERMINAL_MAIN = path.resolve(import.meta.dirname, "../../terminal/src/main.ts");

/** What tests swap: the model, harnesses, extra tools, channel adapters and the scheduler's clock. */
export type CoreOptions = {
  quiet?: boolean;
  llm?: Llm;
  harnesses?: Partial<Record<HarnessId, Harness>>;
  /** Tests add tools of their own next to the built-in ones. */
  extraTools?: Tool[];
  /** Channel adapters by type; tests use a fake one instead of Telegram. */
  channelAdapters?: Record<string, AdapterFactory>;
  /** Waits before a channel that failed to start tries again; tests shorten them. */
  channelRetryMs?: readonly number[];
  /** How long a room waits for one person's quick messages to settle (tests shorten it). */
  roomBurstMs?: number;
  /** How long a turn waits for the owner's answer before it ends and the input stays open (tests shorten it). */
  inputWaits?: InputWaits;
  /** How long an outside engine may go without an event before its turn ends (tests shorten it). */
  engineIdleMs?: number;
  /** The scheduler's clock; tests move it to make routines due. */
  clock?: () => Date;
  /** How long a finished turn's chat may stay unread before the tray notices it (tests shorten it). */
  unseenAfterMs?: number;
  /** Finder and the trash; tests record the calls instead. */
  desktop?: DesktopOps;
  /** Messages on this Mac (by default only on macOS); tests pass their own, null for none. */
  imessage?: IMessageOps | null;
  /** Runs the update's commands (git, pnpm); tests answer them. */
  updateRunner?: Runner;
  /** Closes the core and asks its supervisor to start it again (after an update). */
  restart?: () => void;
};

export async function createCore(config: CoreConfig, opts: CoreOptions = {}) {
  const log = createLog("core", opts.quiet);
  const identity = readIdentity(config.home);
  const db = openDb(config.home);
  const bus = createBus();
  // The engine exists by the time a command ends.
  const terminals = createTerminals({ bus, commandEnded: (e) => wakeAfterCommand(store, engine.admit, e) });
  const store = createStore(db, bus);
  const secrets = createSecrets(config.home, config.secrets);
  seed(store, config.agentName);
  store.idempotency.prune();
  store.nudges.prune();

  const broker = createNodeBroker();
  const push = createPush({ expoUrl: config.expoPushUrl, onError: (err) => log.warn({ err }, "push not delivered") });
  broker.onEvent((_node, event) => {
    if (event.type !== "tabs.changed") return;
    // A node's tabs are checked here, once: operators trust what the core pushes.
    const raw = (event.payload as { tabs?: unknown[] }).tabs ?? [];
    const tabs = raw.flatMap((t) => {
      const r = TabInfo.safeParse(t);
      return r.success ? [r.data] : [];
    });
    bus.emit({ type: "browser.tabs", tabs });
  });

  // The core's own browser when no desktop app lends one; its tabs reach the panel like the desktop's.
  const headless = config.headless
    ? createHeadlessBrowser({
        dir: path.join(config.home, "browser"),
        chrome: typeof config.headless === "string" ? config.headless : undefined,
        blockedPorts: () => new Set([String(listening)]),
        onChange: (tabs) => {
          if (!broker.withCap(BROWSER_CAP)) bus.emit({ type: "browser.tabs", tabs });
        },
      })
    : undefined;

  let selfUrl = "";
  const providers = providerRegistry(store, config.providers);
  const chatgpt = createChatgptLogin({ secrets });
  const signIns = { [OAUTH_CHATGPT]: chatgpt };
  const llm =
    opts.llm ??
    createLlm({
      providers: providers.active,
      secrets,
      firstByteMs: config.llmTimeoutMs,
      media: (id) => mediaData(store, id),
      signIns,
    });
  const harnesses = createHarnesses({
    store,
    llm,
    home: config.home,
    mcpProxy: () => ({
      command: process.execPath,
      args: [TERMINAL_MAIN, "mcp", "--run"],
      env: {
        APX_URL: selfUrl,
        ...(config.token ? { APX_TOKEN: config.token } : {}),
        // Each harness session starts this CLI: with the core's compile cache it skips stripping TypeScript again.
        ...(process.env.NODE_COMPILE_CACHE ? { NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE } : {}),
        ...nodeChildEnv(),
      },
    }),
    ...(opts.harnesses ? { overrides: opts.harnesses } : {}),
  });
  const catalog = createCatalog({ store, secrets, providers: providers.active, home: config.home, signIns });
  const engineIds = knownEngines(store, providers);
  // Live: an ACP agent or a provider added later is recognized without a restart.
  const apc = createApcSync({ store, log, engines: { has: (id) => engineIds.harness.has(id) || providers.has(id) } });
  apc.sync();
  // The port this core answers on: the configured one, or the one the OS gave (tests listen on 0).
  let listening = config.port || 7440;
  const imessage =
    opts.imessage === undefined
      ? process.platform === "darwin" && config.imessage
        ? systemIMessage()
        : undefined
      : (opts.imessage ?? undefined);
  const integrationsOff = mcpConfig(store);
  const google = createGoogle({
    store,
    secrets,
    endpoints: config.googleApi ? googleAt(config.googleApi) : GOOGLE,
    origin: () => `http://127.0.0.1:${listening}`,
    // An integration is off where the owner turned it off, and in a project that takes none of their globals.
    offIn: (project, id) => !integrationsOff.takesGlobals(project) || integrationsOff.offIn(project).includes(id),
  });
  const tools = builtinTools(store, config.home, () => listening, [
    ...imessageTools(imessage),
    ...googleTools(google),
    ...(opts.extraTools ?? []),
  ]);
  // Tools reach the core through the router like any client, as the agent (owner-only methods refuse them).
  // The router exists only after the engine, hence the late binding.
  let routed: Dispatch | undefined;
  const internal = internalCaller(() => routed, log);
  const call: ToolCall = (method, params, as) =>
    internal(
      method,
      params,
      {
        actor: as.owner ? "human" : "agent",
        agent: { id: as.run.agent_id, run_id: as.run.id, thread_id: as.run.thread_id },
      },
      `tool:${as.run.id}:${as.callId}:${randomUUID()}`,
    );
  const mcp = createMcp({ store, secrets, log });
  const { hooks, plugins, extensions } = extensionStack({ store, secrets, bus, log, home: config.home });
  const upkeep = createUpkeep({ store, llm, log });
  const services = createServices({ store, secrets, home: config.home, log });
  const localModels = createModelInstaller({
    dir: path.join(config.home, "models"),
    onReady: (_id, file) => useLocalModel(services, file, store.settings.get("owner_language") || "es"),
  });
  const memory = createMemoryIndex({ store, services, log });
  const skills = createSkillPicker({ store, services, log });
  const attention = createAttention({
    store,
    bus,
    ...(opts.clock ? { now: opts.clock } : {}),
    ...(opts.unseenAfterMs !== undefined ? { unseenAfterMs: opts.unseenAfterMs } : {}),
  });
  const noticePush = createNoticePush({ store, bus, push });
  const channels = createChannels({
    store,
    home: config.home,
    secrets,
    bus,
    log,
    factories: opts.channelAdapters ?? {
      telegram: (c, token) => telegramAdapter(c, token, config.telegramApi ?? "https://api.telegram.org"),
      discord: (c, token) => discordAdapter(c, token, config.discord),
      slack: (c, token) => slackAdapter(c, token, config.slackApi ?? "https://slack.com/api"),
      // The server's address travels in the secret with the token: these run against the owner's own server.
      matrix: (c, secret) => matrixAdapter(c, secret),
      mattermost: (c, secret) => mattermostAdapter(c, secret),
      signal: (c, secret) => signalAdapter(c, secret),
      // The secret is the mailbox's password; the servers are in the channel's settings.
      email: (c, password) => emailAdapter(c, password, { dir: path.join(config.home, "channels", c.id) }),
      whatsapp: (c) =>
        whatsappAdapter({ dir: path.join(config.home, "channels", c.id), selfOwner: c.self_owner === true, log }),
    },
    ...(opts.channelRetryMs ? { retryMs: opts.channelRetryMs } : {}),
    call: internal,
    services,
    attention: attention.add,
    judge: upkeep.judge,
    ...(opts.roomBurstMs !== undefined ? { roomBurstMs: opts.roomBurstMs } : {}),
    pushOwner: (deviceId, text) => {
      const target = store.devices.pushTarget(deviceId);
      if (!target) return false;
      void push(target, { title: "APX", body: text.slice(0, 3500) });
      return true;
    },
  });
  // APX's own profiles, then the ones the owner installed (theirs win an id).
  const profileRoots: ProfileRoot[] = [
    { source: "apx", dir: path.resolve(import.meta.dirname, "../../../examples/profiles") },
    { source: "owner", dir: path.join(config.home, "profiles") },
  ];
  const engine = createEngine({
    store,
    harnesses,
    tools,
    log,
    call,
    home: config.home,
    apxPort: () => listening,
    memory,
    skills,
    profileRoots,
    build: { version: identity.version, code_sha: identity.code_sha },
    hooks,
    ...(opts.inputWaits ? { inputWaits: opts.inputWaits } : {}),
    ...(opts.engineIdleMs ? { engineIdleMs: opts.engineIdleMs } : {}),
    mcpTools: mcp.toolsFor,
    mcpServers: mcp.serversFor,
    hasCap: (cap) => Boolean(broker.withCap(cap)) || (cap === BROWSER_CAP && Boolean(headless?.available())),
    afterRun: (run) => {
      upkeep.afterRun(run);
      channels.afterRun(run);
      scheduler.afterRun(run);
      afterWorkTurn(store, engine.admit, run);
    },
  });
  const scheduler = officeScheduler({
    store,
    admit: (a) => engine.admit(a),
    attention,
    notifyOwner: (body, threadId) => channels.notifyOwner(body, "notice", threadId),
    log,
    ...(opts.clock ? { now: opts.clock } : {}),
  });

  const updates = createUpdates({
    root: path.resolve(import.meta.dirname, "../../.."),
    log,
    enabled: config.updates,
    supervised: config.supervised,
    version: identity.version,
    app: config.app,
    feed: config.releases,
    ...(opts.updateRunner ? { run: opts.updateRunner } : {}),
    ...(opts.restart ? { restart: opts.restart } : {}),
  });

  const dispatch = createRouter(
    coreHandlers({
      addresses: () => reachableAt(config.host, listening, config.publicUrl),
      terminals,
      access: createAccess({
        home: config.home,
        running: { host: config.host, publicUrl: config.publicUrl, token: config.token },
        port: () => listening,
        addresses: () => reachableAt(config.host, listening, config.publicUrl),
        // Only a supervisor brings a stopped core back.
        restart: config.supervised ? opts.restart : undefined,
      }),
      store,
      log,
      identity,
      broker,
      headless,
      llmLabel: () => llm.label(),
      engine,
      upkeep,
      memory,
      channels,
      services,
      scheduler,
      nudges: scheduler.nudges,
      extensions,
      mcp,
      google,
      providers,
      secrets,
      chatgpt: { login: chatgpt, v1Home: config.v1.home },
      localModels,
      app: {
        harnesses,
        v1: config.v1,
        catalog,
        apc,
        engines: engineIds,
        home: config.home,
        imessage: imessage !== undefined,
      },
      apc,
      engines: engineIds,
      tools,
      desktop: opts.desktop ?? systemDesktop,
      native: config.native,
      runtimeHomes: config.runtimeSkills.homes,
      updates,
      panel: () => panelEntry(servedPanel(config)),
      profileRoots,
      // APX's own templates, then the owner's v1 vault (read-only).
      templateRoots: [
        { source: "apx", dir: path.resolve(import.meta.dirname, "../../../examples/agents") },
        { source: "v1", dir: path.join(config.v1.home, "agents") },
      ],
    }),
    store.idempotency,
  );
  routed = dispatch;

  const transport = await listen(config, { dispatch, store, log, identity, broker, bus });
  listening = transport.port;
  const url = transport.url;
  selfUrl = url;
  engine.start();
  await channels.start();
  scheduler.start();
  updates.start();
  // The owner's skills get their vectors now, so the first message does not wait for them.
  skills.warm(skillsFor(store, config.home, undefined));
  if (config.runtimeSkills.auto) keepRuntimeSkills(config.runtimeSkills.homes, log);
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
    scheduler,
    async close() {
      terminals.closeAll();
      updates.stop();
      chatgpt.stop();
      localModels.cancel();
      headless?.close();
      scheduler.stop();
      attention.stop();
      noticePush.stop();
      plugins.close();
      await channels.stop();
      await engine.stop();
      services.close();
      await upkeep.stop();
      await mcp.close();
      apc.close();
      await transport.close();
      db.close();
    },
  };
}

/** Other agent apps get this version's skills for APX; a folder APX cannot write is only logged. */
function keepRuntimeSkills(homes: Parameters<typeof syncRuntimeSkills>[0], log: Log): void {
  setImmediate(() => {
    try {
      const changed = syncRuntimeSkills(homes).steps.filter(
        (s) => s.action !== "unchanged" && s.action !== "skip-link",
      );
      if (changed.length)
        log.info(
          { skills: changed.map((s) => `${s.runtime.id}:${s.name}:${s.action}`) },
          "skills for other agent apps updated",
        );
    } catch (err) {
      log.warn({ err: errorMessage(err) }, "could not update the skills for other agent apps");
    }
  });
}
