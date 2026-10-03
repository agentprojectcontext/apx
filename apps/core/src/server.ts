// Composition root: config → identity → db/store → providers → harnesses → engine → router → transports.
// Only wiring lives here. Tests call createCore directly (with a temp home and fakes).

import { randomUUID } from "node:crypto";
import path from "node:path";
import { type HarnessId, TabInfo } from "@apx/protocol";
import { createApcSync } from "./apc/sync.ts";
import { createBus } from "./bus.ts";
import { discordAdapter } from "./channels/discord.ts";
import { createChannels } from "./channels/manager.ts";
import { slackAdapter } from "./channels/slack.ts";
import { telegramAdapter } from "./channels/telegram.ts";
import type { AdapterFactory } from "./channels/types.ts";
import { whatsappAdapter } from "./channels/whatsapp.ts";
import type { CoreConfig } from "./config.ts";
import { openDb } from "./db/db.ts";
import { type DesktopOps, systemDesktop } from "./desktop.ts";
import { seed } from "./domain/seed.ts";
import { createStore } from "./domain/store.ts";
import { createAttention } from "./engine/attention.ts";
import { createEngine } from "./engine/engine.ts";
import { createMemoryIndex } from "./engine/memory-index.ts";
import { afterTaskTurn } from "./engine/office.ts";
import { createSkillPicker } from "./engine/skill-pick.ts";
import type { ToolCall } from "./engine/turn.ts";
import { createUpkeep } from "./engine/upkeep.ts";
import { createHarnesses, type Harness } from "./harness/index.ts";
import { readIdentity } from "./identity.ts";
import { type IMessageOps, systemIMessage } from "./imessage.ts";
import { createLog } from "./log.ts";
import { createMcp } from "./mcp/manager.ts";
import { createCatalog } from "./models/catalog.ts";
import { createNodeBroker } from "./nodes/broker.ts";
import { officeScheduler } from "./office-wiring.ts";
import { createLlm, type Llm } from "./providers/llm.ts";
import { providerRegistry } from "./providers/registry.ts";
import { internalCaller } from "./rpc/internal.ts";
import { createRouter, type Dispatch } from "./rpc/router.ts";
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
import { createServices } from "./services/registry.ts";
import { mediaData } from "./services/uploads.ts";
import { skillsFor } from "./skills/skills.ts";
import { imessageTools } from "./tools/imessage.ts";
import type { Tool } from "./tools/types.ts";
import { createUpdates, type Runner } from "./updates.ts";

/** `apx2 mcp --run` (token in APX_RUN_TOKEN): how an external harness (Codex) reaches the tools of its run. */
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
  /** The scheduler's clock; tests move it to make routines due. */
  clock?: () => Date;
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
  const store = createStore(db, bus);
  const secrets = createSecrets(config.home, config.secrets);
  seed(store);
  store.idempotency.prune();

  const broker = createNodeBroker();
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

  let selfUrl = "";
  const providers = providerRegistry(store, config.providers);
  const llm =
    opts.llm ??
    createLlm({
      providers: providers.active,
      secrets,
      firstByteMs: config.llmTimeoutMs,
      media: (id) => mediaData(store, id),
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
      },
    }),
    ...(opts.harnesses ? { overrides: opts.harnesses } : {}),
  });
  const catalog = createCatalog({ store, secrets, providers: providers.active, home: config.home });
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
  const tools = builtinTools(store, config.home, () => listening, [
    ...imessageTools(imessage),
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
  const memory = createMemoryIndex({ store, services, log });
  const skills = createSkillPicker({ store, services, log });
  const attention = createAttention({ store, bus, ...(opts.clock ? { now: opts.clock } : {}) });
  const channels = createChannels({
    store,
    secrets,
    bus,
    log,
    factories: opts.channelAdapters ?? {
      telegram: (c, token) => telegramAdapter(c, token, config.telegramApi ?? "https://api.telegram.org"),
      discord: (c, token) => discordAdapter(c, token, config.discord),
      slack: (c, token) => slackAdapter(c, token, config.slackApi ?? "https://slack.com/api"),
      whatsapp: (c) =>
        whatsappAdapter({ dir: path.join(config.home, "channels", c.id), selfOwner: c.self_owner === true, log }),
    },
    ...(opts.channelRetryMs ? { retryMs: opts.channelRetryMs } : {}),
    call: internal,
    services,
    attention: attention.add,
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
    skills,
    hooks,
    mcpTools: mcp.toolsFor,
    afterRun: (run) => {
      upkeep.afterRun(run);
      channels.afterRun(run);
      scheduler.afterRun(run);
      afterTaskTurn(store, engine.admit, run);
    },
  });
  const scheduler = officeScheduler({
    store,
    admit: (a) => engine.admit(a),
    attention,
    notifyOwner: (text, threadId) => channels.notifyOwner({ text }, "notice", threadId),
    log,
    ...(opts.clock ? { now: opts.clock } : {}),
  });

  const updates = createUpdates({
    root: path.resolve(import.meta.dirname, "../../.."),
    log,
    enabled: config.updates,
    supervised: config.supervised,
    ...(opts.updateRunner ? { run: opts.updateRunner } : {}),
    ...(opts.restart ? { restart: opts.restart } : {}),
  });

  const dispatch = createRouter(
    coreHandlers({
      addresses: () => reachableAt(config.host, listening),
      store,
      identity,
      broker,
      llmLabel: () => llm.label(),
      engine,
      upkeep,
      memory,
      channels,
      services,
      scheduler,
      extensions,
      mcp,
      providers,
      secrets,
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
      desktop: opts.desktop ?? systemDesktop,
      native: config.native,
      updates,
      panel: () => panelEntry(servedPanel(config)),
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
      updates.stop();
      scheduler.stop();
      attention.stop();
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
