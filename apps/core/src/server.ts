// Composition root: config → identity → db/store → providers → harnesses → engine → router → transports.
// Only wiring lives here. Tests call createCore directly (with a temp home and fakes).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BROWSER_CAP, type HarnessId, TabInfo } from "@apx/protocol";
import {
  createDesktopInstaller,
  type DesktopInstaller,
  type DesktopInstallOptions,
} from "../../../packages/install/src/desktop.ts";
import { prepareLocalTarget } from "../../../packages/install/src/paths.ts";
import { desktopSessionEnv } from "../../../packages/install/src/session.ts";
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
import { coreLogSink } from "./core-log.ts";
import { openDb } from "./db/db.ts";
import { type DesktopOps, systemDesktop } from "./desktop.ts";
import { cleanUpCapturedNotes } from "./domain/memory-capture-cleanup.ts";
import { seed } from "./domain/seed.ts";
import { createStore } from "./domain/store.ts";
import { announceRelease } from "./domain/whats-new.ts";
import { createAttention } from "./engine/attention.ts";
import { createEngine, type RunTimers } from "./engine/engine.ts";
import type { InputWaits } from "./engine/inputs.ts";
import { createMemoryIndex } from "./engine/memory-index.ts";
import { createMemoryMaintenance } from "./engine/memory-maintenance.ts";
import { createNoticePush } from "./engine/notice-push.ts";
import { createPermissions } from "./engine/permissions.ts";
import type { ProfileRoot } from "./engine/profiles.ts";
import { createSkillPicker } from "./engine/skill-pick.ts";
import { createDrafter } from "./engine/suggest.ts";
import { afterWorkTurn } from "./engine/task-work.ts";
import { wakeAfterCommand } from "./engine/terminal-wake.ts";
import type { ToolCall } from "./engine/turn.ts";
import { createUpkeep } from "./engine/upkeep.ts";
import { errorMessage } from "./errors.ts";
import { thisRunner, writeApxCommand } from "./harness/apx-command.ts";
import type { CliStatus } from "./harness/detect.ts";
import { which } from "./harness/detect.ts";
import { harnessEnv, useApxCommand, useUsualDirs } from "./harness/env.ts";
import { createHarnesses, type Harness } from "./harness/index.ts";
import { readIdentity } from "./identity.ts";
import { createIdleTrim } from "./idle-memory.ts";
import { type IMessageOps, systemIMessage } from "./imessage.ts";
import { createAsana } from "./integrations/asana.ts";
import { gmailApi } from "./integrations/gmail.ts";
import { createGoogle } from "./integrations/google.ts";
import { apxGoogleClient, clientFromPair } from "./integrations/google-client.ts";
import { GOOGLE, googleAt } from "./integrations/google-oauth.ts";
import { createLog, type Log } from "./log.ts";
import { mcpConfig } from "./mcp/config.ts";
import { agentFiles } from "./mcp/file-args.ts";
import { createMcp } from "./mcp/manager.ts";
import { createCatalog } from "./models/catalog.ts";
import { createNews } from "./news/news.ts";
import { nodeChildEnv } from "./node-runtime.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { createHeadlessBrowser } from "./nodes/headless-browser.ts";
import { officeScheduler } from "./office-wiring.ts";
import { createChatgptLogin } from "./providers/chatgpt-login.ts";
import { createLlm, type Llm } from "./providers/llm.ts";
import { providerRegistry } from "./providers/registry.ts";
import { localReleases, type ReleaseSource } from "./release-notes.ts";
import { useLocalEmbedder } from "./rpc/embeddings.ts";
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
import { CODEX_IMAGE_SERVICE, CODEX_IMAGES, createCodexImages } from "./services/codex-images.ts";
import { createLocalEmbeddings } from "./services/local-embed.ts";
import { createModelInstaller } from "./services/local-whisper.ts";
import { createPush } from "./services/push.ts";
import { createServices } from "./services/registry.ts";
import { mediaData } from "./services/uploads.ts";
import { syncRuntimeSkills } from "./skills/runtimes.ts";
import { skillsFor } from "./skills/skills.ts";
import { createTelemetry } from "./telemetry.ts";
import { type TelemetrySink, telemetrySink } from "./telemetry-sink.ts";
import { createTerminals } from "./terminal/terminals.ts";
import { asanaTools } from "./tools/asana.ts";
import { scratchRoot } from "./tools/folders.ts";
import { googleTools } from "./tools/google.ts";
import { imessageTools } from "./tools/imessage.ts";
import type { Tool } from "./tools/types.ts";
import { createUpdates, type Runner } from "./updates.ts";

/** `apx mcp --run` (token in APX_RUN_TOKEN): how an external harness (Codex) reaches the tools of its run. */
const TERMINAL_MAIN = path.resolve(import.meta.dirname, "../../terminal/src/main.ts");

/** What tests swap: the model, harnesses, extra tools, channel adapters and the scheduler's clock. */
export type CoreOptions = {
  /** Asana transport; tests record REST requests without contacting an account. */
  asanaFetch?: typeof fetch;
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
  /** How long a supervised contact's quick messages may keep coming before their draft (tests shorten it). */
  suggestBurstMs?: number;
  /** How long a turn waits for the owner's answer before it ends and the input stays open (tests shorten it). */
  inputWaits?: InputWaits;
  /** How long an outside engine may go without an event before its turn ends (tests shorten it). */
  engineIdleMs?: number;
  /** How long a turn on our own loop may go without progress before it ends (tests shorten it). */
  turnIdleMs?: number;
  /** The most a delegated run may work in all (tests shorten it). */
  a2aCapMs?: number;
  runTimers?: RunTimers;
  /** The scheduler's clock; tests move it to make routines due. */
  clock?: () => Date;
  /** How long a finished turn's chat may stay unread before the tray notices it (tests shorten it). */
  unseenAfterMs?: number;
  /** Finder and the trash; tests record the calls instead. */
  desktop?: DesktopOps;
  desktopInstaller?: DesktopInstaller;
  /** Messages on this Mac (by default only on macOS); tests pass their own, null for none. */
  imessage?: IMessageOps | null;
  /** Runs the update's commands (git, pnpm); tests answer them. */
  updateRunner?: Runner;
  /** Where telemetry goes instead of config.telemetry's sink (tests record it). */
  telemetrySink?: TelemetrySink;
  /** Closes the core and asks its supervisor to start it again (after an update). */
  restart?: () => void;
  /** What each release changed, instead of this APX's own (release-notes.ts); tests stand in a release. */
  releases?: ReleaseSource;
};

export async function createCore(config: CoreConfig, opts: CoreOptions = {}) {
  const log = createLog("core", opts.quiet, opts.quiet ? undefined : coreLogSink(config.home));
  const identity = readIdentity(config.home);
  const db = openDb(config.home);
  const bus = createBus();
  // The engine exists by the time a command ends.
  const terminals = createTerminals({ bus, commandEnded: (e) => wakeAfterCommand(store, engine.admit, e) });
  const store = createStore(db, bus);
  const secrets = createSecrets(config.home, config.secrets);
  seed(store, config.agentName);
  const releases =
    opts.releases ?? (config.whatsNew ? localReleases(path.resolve(import.meta.dirname, "../../..")) : undefined);
  // The release this install was on before this start: news it already had are not told as new.
  const previousRelease = store.settings.get("release_seen");
  try {
    if (releases) announceRelease(store, releases);
  } catch (err) {
    log.warn({ err: errorMessage(err) }, "release notes not told");
  }
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
  // Bound once the services exist: what the engines' check finds about Codex decides its image service.
  let codexSeen: ((codex: CliStatus) => void) | undefined;
  const harnesses = createHarnesses({
    store,
    llm,
    onDetected: ({ codex }) => codexSeen?.(codex),
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
    // A stand-in Google never takes APX's real client.
    builtin: clientFromPair(config.googleClient) ?? (config.googleApi ? undefined : apxGoogleClient()),
  });
  const asana = createAsana({
    secrets,
    fetch: opts.asanaFetch,
    offIn: (project) => !integrationsOff.takesGlobals(project) || integrationsOff.offIn(project).includes("asana"),
  });
  const tools = builtinTools(
    store,
    config.home,
    () => listening,
    [...imessageTools(imessage), ...googleTools(google), ...asanaTools(asana, store), ...(opts.extraTools ?? [])],
    config.runtimeSkills.homes,
  );
  // Tools reach the core through the router like any client, as the agent (owner-only methods refuse them).
  // The router exists only after the engine, hence the late binding.
  let routed: Dispatch | undefined;
  const internal = internalCaller(() => routed, log);
  // Every permission question about an agent, from tools, outside agents and the methods tools call.
  const permissions = createPermissions({ store, home: config.home });
  const call: ToolCall = (method, params, as) =>
    internal(
      method,
      params,
      {
        actor: as.owner ? "human" : "agent",
        agent: { id: as.run.agent_id, run_id: as.run.id, thread_id: as.run.thread_id, call_id: as.callId },
      },
      `tool:${as.run.id}:${as.callId}:${randomUUID()}`,
    );
  const mcp = createMcp({
    store,
    secrets,
    log,
    workDir: path.join(scratchRoot(config.home), "mcp"),
    files: (thread) => agentFiles(store, config.home, thread),
  });
  const { hooks, plugins, extensions } = extensionStack({ store, secrets, bus, log, home: config.home });
  const upkeep = createUpkeep({ store, llm, log });
  const services = createServices({
    store,
    secrets,
    home: config.home,
    log,
    codexImages: createCodexImages({
      codexPath: () => which("codex"),
      signedIn: async () => (await harnesses.status()).some((e) => e.id === "codex" && e.logged_in),
      env: harnessEnv,
      workDir: path.join(config.home, "codex-images"),
    }),
  });
  // Codex signed in here draws with the owner's ChatGPT plan: added once, first of the image services.
  codexSeen = (codex) => {
    if (codex.logged_in && services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE))
      log.info({ service: CODEX_IMAGES }, "Codex is signed in: it draws images first now");
  };
  const localModels = createModelInstaller({
    dir: path.join(config.home, "models"),
    onReady: (_id, file) => useLocalModel(services, file, store.settings.get("owner_language") || "es"),
  });
  const localEmbeds = createLocalEmbeddings({
    url: config.ollamaUrl,
    onReady: (model) => useLocalEmbedder(services, config.ollamaUrl, model),
  });
  const memory = createMemoryIndex({ store, services, log });
  const memoryMaintenance = createMemoryMaintenance({ store, upkeep, call: internal, index: memory, log });
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
    ownerReplied: (messageId) => memoryMaintenance.ownerReplied(messageId),
    draft: createDrafter({ store, llm, fallbackModels: upkeep.auxModels }).draft,
    ...(opts.roomBurstMs !== undefined ? { roomBurstMs: opts.roomBurstMs } : {}),
    ...(opts.suggestBurstMs !== undefined ? { suggestBurstMs: opts.suggestBurstMs } : {}),
    pushOwner: (deviceId, text) => {
      const target = store.devices.pushTarget(deviceId);
      if (!target) return false;
      void push(target, { title: "APX", body: text.slice(0, 3500) });
      return true;
    },
  });
  const news = createNews({
    store,
    llm,
    models: upkeep.voiceModels,
    notifyOwner: (body, threadId) => channels.notifyOwner(body, "notice", threadId),
    log,
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
    permissions,
    home: config.home,
    skillApps: config.runtimeSkills.homes,
    apxPort: () => listening,
    memory,
    skills,
    profileRoots,
    build: { version: identity.version, code_sha: identity.code_sha },
    hooks,
    ...(opts.inputWaits ? { inputWaits: opts.inputWaits } : {}),
    ...(opts.engineIdleMs ? { engineIdleMs: opts.engineIdleMs } : {}),
    ...(opts.turnIdleMs ? { turnIdleMs: opts.turnIdleMs } : {}),
    ...(opts.a2aCapMs ? { a2aCapMs: opts.a2aCapMs } : {}),
    ...(opts.runTimers ? { runTimers: opts.runTimers } : {}),
    mcpTools: mcp.toolsFor,
    mcpServers: mcp.serversFor,
    hasCap: (cap) => Boolean(broker.withCap(cap)) || (cap === BROWSER_CAP && Boolean(headless?.available())),
    desktopLinked: () => Boolean(broker.withCap(BROWSER_CAP)),
    // Mail routines read the inbox only with the owner's own Google client: APX's can only send.
    mail: {
      readable: (project) => google.usable("gmail", project) && google.full("gmail"),
      historyId: () => gmailApi(google).historyId(),
      arrived: (from) => gmailApi(google).arrived(from),
    },
    afterRun: (run) => {
      upkeep.afterRun(run);
      memoryMaintenance.afterRun(run);
      channels.afterRun(run);
      scheduler.afterRun(run);
      scheduler.stalls.afterRun(run);
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
    enabled: config.updates !== "off",
    byApp: config.updates === "app",
    supervised: config.supervised,
    version: identity.version,
    app: config.app,
    feed: config.releases,
    ...(opts.updateRunner ? { run: opts.updateRunner } : {}),
    ...(opts.restart ? { restart: opts.restart } : {}),
  });

  const telemetry = createTelemetry({
    home: config.home,
    store,
    log,
    // A checkout's package.json holds a placeholder: its commit tells one checkout from another.
    version: identity.version === "0.0.0" ? `0.0.0+${identity.code_sha.slice(0, 12)}` : identity.version,
    channel: telemetryChannel(config),
    sink: opts.telemetrySink ?? (config.telemetry ? telemetrySink(config.telemetry) : undefined),
  });

  const desktopInstaller =
    opts.desktopInstaller ??
    createDesktopInstaller({
      platform: process.platform,
      arch: process.arch,
      userHome: os.homedir(),
      env: { ...process.env },
      feed: config.releases ?? "off",
      session: () => desktopSessionEnv(process.platform, { ...process.env }),
      target: () => prepareLocalTarget({ home: config.home, port: listening, home_id: identity.home_id }, config.token),
    } satisfies DesktopInstallOptions);

  const dispatch = createRouter(
    coreHandlers({
      internal,
      permissions,
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
      bus,
      llmLabel: () => llm.label(),
      engine,
      upkeep,
      memory,
      memoryMaintenance,
      channels,
      services,
      scheduler,
      nudges: scheduler.nudges,
      extensions,
      mcp,
      google,
      asana,
      providers,
      secrets,
      chatgpt: { login: chatgpt, v1Home: config.v1.home },
      localModels,
      localEmbeds,
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
      desktopInstaller,
      native: config.native,
      runtimeHomes: config.runtimeSkills.homes,
      updates,
      telemetry,
      news,
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
  const cleanup = cleanUpCapturedNotes(store);
  if (cleanup) log.info(cleanup, "captured memory cleanup: retired noisy automatic notes");
  memoryMaintenance.start();

  const transport = await listen(config, { dispatch, store, log, identity, broker, bus });
  listening = transport.port;
  // Agents' shells and harnesses reach this core with `apx`, whatever the owner's PATH holds.
  try {
    useApxCommand(writeApxCommand(config.home, listening, thisRunner()));
    useUsualDirs(config.supervised);
  } catch (err) {
    log.warn({ err: errorMessage(err) }, "apx command not written");
  }
  const url = transport.url;
  selfUrl = url;
  engine.start();
  await channels.start();
  // After the channels: the message goes out on one (it waits in the outbox until that one is up).
  if (config.news)
    void news
      .atBoot(previousRelease)
      .catch((err) => log.warn({ err: errorMessage(err, 200) }, "release news not told; the next start tries again"));
  scheduler.start();
  updates.start();
  telemetry.start();
  const idleTrim = createIdleTrim();
  idleTrim.start();
  // The owner's skills get their vectors now, so the first message does not wait for them.
  skills.warm(skillsFor(store, { home: config.home, apps: config.runtimeSkills.homes }, undefined));
  if (config.runtimeSkills.auto) {
    keepRuntimeSkills(config.runtimeSkills.homes, log);
    // A core that looks after this machine's agent CLIs asks them once now, so a signed-in Codex can draw at once.
    void harnesses.status().catch(() => {});
  }
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
    telemetry,
    async close() {
      await desktopInstaller.close();
      useApxCommand(undefined);
      idleTrim.stop();
      terminals.closeAll();
      updates.stop();
      telemetry.stop();
      chatgpt.stop();
      localModels.cancel();
      headless?.close();
      scheduler.stop();
      await news.stop();
      attention.stop();
      noticePush.stop();
      plugins.close();
      await channels.stop();
      await engine.stop();
      await upkeep.stop();
      await memoryMaintenance.stop();
      await memory.stop();
      services.close();
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

/** Where this APX came from, for telemetry: the desktop app's core, an install.sh/ps1 bundle, or a git checkout. */
function telemetryChannel(config: CoreConfig): "source" | "bundle" | "app" | "other" {
  if (config.updates === "app") return "app";
  if (config.app) return "bundle";
  return fs.existsSync(path.resolve(import.meta.dirname, "../../../.git")) ? "source" : "other";
}
