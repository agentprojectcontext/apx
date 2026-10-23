// One config loader, injected everywhere (no import-time singletons, no process.env reads elsewhere).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_ENV_FILE, coreEnvDefaults, parseCoreEnv, RELEASE_FEED } from "@apx/protocol";
import { type SecretsBackend, systemBackend } from "./secrets-stores.ts";
import { TELEMETRY_SINK } from "./telemetry-sink.ts";

/**
 * Where v2 keeps its state: inside the APX folder, apart from v1's files (which stay as they are until the owner
 * moves on). See DECISIONS.md#d-024
 */
export const defaultHome = () => path.join(os.homedir(), ".apx", "v2");
/** Where v2 lived before it moved into ~/.apx (moved once, at start: see home.ts). */
export const legacyHome = () => path.join(os.homedir(), ".apx2");

export type ProviderTransport = "openai-chat" | "anthropic-messages" | "chatgpt-responses";

/** A model API. `key` is a reference (secret://name, env:VAR, or oauth:<login> for a sign-in), never the value. */
export type ProviderConfig = {
  id: string;
  transport: ProviderTransport;
  base_url: string;
  key: string;
  /**
   * Fixed list for gateways that cannot list their models (local servers, APX_LLM_MODELS); empty = ask the provider.
   * Which model runs is never decided here: see models/choice.ts.
   */
  models: string[];
  /** The name people read; built-in providers carry their brand's. */
  label?: string | undefined;
};

export type CoreConfig = {
  host: string;
  port: number;
  /** State home. v2 lives beside v1 (~/.apx) until the cut-over. */
  home: string;
  /** Required whenever host is not loopback. */
  token: string | undefined;
  /** Extra origins allowed to call the core (comma separated in APX_ALLOWED_ORIGINS). */
  allowedOrigins: string[];
  /** Built panel to serve; undefined = the workspace build when present. */
  webDist: string | undefined;
  /** Local APX v1 daemon, only for the explicit read-only import. */
  v1: { url: string; home: string };
  /** Where Claude Code and Codex keep the owner's own sessions (read-only, to go on with one in APX). */
  native: { claude: string; codex: string };
  /**
   * Other agent apps' folders (Claude Code, Codex, Cursor, ~/.agents): their skills are read from there, and APX's skills
   * for them written there. `auto`: those kept up to date at every start; only a core on the default home does it
   * (APX_RUNTIME_SKILLS=on|off overrides).
   */
  runtimeSkills: { homes: { home: string; claude: string; codex: string }; auto: boolean };
  /** Telegram's Bot API; a test environment points it at an emulated one (APX_TELEGRAM_API). */
  telegramApi: string | undefined;
  /** Discord's REST API and Gateway; a test environment points them at an emulated one (APX_DISCORD_API, _GATEWAY). */
  discord: { api: string; gateway: string; cdn: string } | undefined;
  /**
   * The address devices reach this core on from outside (a VPS or a Tailscale name, e.g. https://apx.example.ts.net):
   * it goes first in a pairing QR.
   */
  publicUrl: string | undefined;
  /** Expo's push service; a test environment points it at a fake one (APX_EXPO_PUSH_URL). */
  expoPushUrl: string;
  /** Slack's Web API; a test environment points it at an emulated one (APX_SLACK_API). */
  slackApi: string | undefined;
  /** Google's sign-in and REST APIs under one address; a test environment points it at a fake one (APX_GOOGLE_API). */
  googleApi: string | undefined;
  /** A Google OAuth client (`client_id:client_secret`) in place of the one this build ships (APX_GOOGLE_CLIENT). */
  googleClient: string | undefined;
  /** iMessage tools on a Mac; APX_IMESSAGE=off hides them (a sandbox must never reach the owner's Messages). */
  imessage: boolean;
  /**
   * The core's own headless Chrome when no desktop app lends a browser: `false` turns it off (APX_HEADLESS=off; a
   * test core never starts one), a path picks the browser (APX_CHROME), true finds one.
   */
  headless: boolean | string;
  /** Ollama on this machine, for memory's embedding models (APX_OLLAMA_URL; a test points it elsewhere). */
  ollamaUrl: string;
  providers: ProviderConfig[];
  secrets: SecretsBackend;
  /** Silence before the first byte of a model answer. */
  llmTimeoutMs: number;
  /** The super-agent's name on a fresh install (APX_AGENT_NAME); none = one picked at random. */
  agentName: string | undefined;
  /** Look for a newer APX now and then (APX_UPDATES): on; app = only say so, the desktop app installs it; off. */
  updates: "on" | "app" | "off";
  /** The super-agent tells what an update brought, on the first start of a newer release (APX_WHATS_NEW=off: never). */
  whatsNew: boolean;
  /**
   * The super-agent tells release news that applies to the owner, in its words on their channel (APX_NEWS=off: never;
   * test cores start off, APX_NEWS=on turns it on there).
   */
  news: boolean;
  /** A supervisor starts the core again when it exits to update (`pnpm app` sets APX_SUPERVISED=1). */
  supervised: boolean;
  /** APX_APP: where install.sh/ps1 put this daemon (its bundles and `current`); unset for a checkout or the app. */
  app: string | undefined;
  /** owner/repo whose Releases announce newer bundles (APX_RELEASES; "off" stops it). */
  releases: string | undefined;
  /**
   * Where telemetry goes (APX_TELEMETRY: a sink, or "off"); undefined sends nothing. DO_NOT_TRACK=1 and CI turn it off
   * too. See telemetry-sink.ts.
   */
  telemetry: string | undefined;
};

/** The key reference of the ChatGPT plan's sign-in. */
export const OAUTH_CHATGPT = "oauth:chatgpt";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "gemini",
    label: "Gemini",
    transport: "openai-chat",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: "secret://gemini",
    models: [],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    transport: "anthropic-messages",
    base_url: "https://api.anthropic.com",
    key: "secret://anthropic",
    models: [],
  },
  {
    id: "openai",
    label: "OpenAI",
    transport: "openai-chat",
    base_url: "https://api.openai.com/v1",
    key: "secret://openai",
    models: [],
  },
  // The owner's ChatGPT plan, signed in from APX the way Codex signs in (see providers/chatgpt-login.ts).
  {
    id: "chatgpt",
    label: "Codex",
    transport: "chatgpt-responses",
    base_url: "https://chatgpt.com/backend-api/codex",
    key: OAUTH_CHATGPT,
    models: [],
  },
];

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** `<home>/core.env` (written by `apx expose`) as defaults under the process environment, which always wins. */
export function withCoreEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = env.APX_HOME ?? defaultHome();
  let text: string;
  try {
    text = fs.readFileSync(path.join(home, CORE_ENV_FILE), "utf8");
  } catch {
    return env;
  }
  return { ...coreEnvDefaults(parseCoreEnv(text)), ...env };
}

/** `readCoreEnv: false` keeps the result independent of any file on disk (tests, embedders). */
export function loadConfig(processEnv: NodeJS.ProcessEnv = process.env, readCoreEnv = true): CoreConfig {
  const env = readCoreEnv ? withCoreEnv(processEnv) : processEnv;
  // APX_LLM_* puts one custom OpenAI-compatible provider first (local models, tests, other gateways).
  const custom: ProviderConfig[] = env.APX_LLM_BASE_URL
    ? [
        {
          id: "custom",
          label: "Custom",
          transport: "openai-chat",
          base_url: env.APX_LLM_BASE_URL,
          key: env.APX_LLM_KEY_REF ?? "env:APX_LLM_KEY",
          models: list(env.APX_LLM_MODELS),
        },
      ]
    : [];
  const config: CoreConfig = {
    host: env.APX_HOST ?? "127.0.0.1",
    port: Number(env.APX_PORT ?? 7440),
    home: env.APX_HOME ?? defaultHome(),
    token: env.APX_TOKEN || undefined,
    allowedOrigins: list(env.APX_ALLOWED_ORIGINS),
    webDist: env.APX_WEB_DIST || undefined,
    v1: { url: env.APX_V1_URL ?? "http://127.0.0.1:7430", home: env.APX_V1_HOME ?? path.join(os.homedir(), ".apx") },
    telegramApi: env.APX_TELEGRAM_API || undefined,
    discord:
      env.APX_DISCORD_API && env.APX_DISCORD_GATEWAY
        ? { api: env.APX_DISCORD_API, gateway: env.APX_DISCORD_GATEWAY, cdn: env.APX_DISCORD_API }
        : undefined,
    slackApi: env.APX_SLACK_API || undefined,
    googleApi: env.APX_GOOGLE_API || undefined,
    googleClient: env.APX_GOOGLE_CLIENT || undefined,
    publicUrl: env.APX_PUBLIC_URL?.replace(/\/$/, "") || undefined,
    expoPushUrl: env.APX_EXPO_PUSH_URL || "https://exp.host/--/api/v2/push/send",
    imessage: env.APX_IMESSAGE !== "off",
    headless: env.APX_HEADLESS === "off" ? false : env.APX_CHROME || true,
    native: {
      claude: env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
      codex: env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    },
    runtimeSkills: {
      homes: {
        // Where ~/.cursor and ~/.agents are looked for; a sandbox points it away from the owner's (APX_APPS_HOME).
        home: env.APX_APPS_HOME || os.homedir(),
        claude: env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
        codex: env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
      },
      // A scratch core (its own APX_HOME) must not rewrite the owner's apps with its checkout's text.
      auto: env.APX_RUNTIME_SKILLS === "on" || (!env.APX_HOME && env.APX_RUNTIME_SKILLS !== "off"),
    },
    ollamaUrl: env.APX_OLLAMA_URL || "http://127.0.0.1:11434",
    providers: [...custom, ...DEFAULT_PROVIDERS],
    secrets: env.APX_SECRETS === "file" ? "file" : systemBackend(),
    llmTimeoutMs: Number(env.APX_LLM_TIMEOUT_MS ?? 45_000),
    agentName: env.APX_AGENT_NAME?.trim() || undefined,
    updates: env.APX_UPDATES === "off" ? "off" : env.APX_UPDATES === "app" ? "app" : "on",
    whatsNew: env.APX_WHATS_NEW !== "off",
    news: env.APX_NEWS !== "off",
    supervised: env.APX_SUPERVISED === "1",
    app: env.APX_APP || undefined,
    releases: env.APX_RELEASES === "off" ? undefined : env.APX_RELEASES || RELEASE_FEED,
    telemetry: telemetryOff(env) ? undefined : env.APX_TELEMETRY || TELEMETRY_SINK,
  };
  assertSafeBind(config);
  return config;
}

/** The owner, the shell or a CI said no telemetry (https://consoledonottrack.com). */
function telemetryOff(env: NodeJS.ProcessEnv): boolean {
  const yes = (v: string | undefined) => Boolean(v) && v !== "0" && v !== "false";
  return env.APX_TELEMETRY === "off" || yes(env.DO_NOT_TRACK) || yes(env.CI);
}

export function assertSafeBind(config: Pick<CoreConfig, "host" | "token">): void {
  if (!LOOPBACK.has(config.host) && !config.token) {
    throw new Error(`refusing to listen on ${config.host} without APX_TOKEN`);
  }
}

/** Config for tests and embedders: defaults plus overrides, no environment. */
export function testConfig(over: Partial<CoreConfig> & { home: string }): CoreConfig {
  // Never the machine's real v1: a test that wants one passes it.
  const v1 = { url: "http://127.0.0.1:9", home: path.join(over.home, "v1") };
  const native = { claude: path.join(over.home, "claude-home"), codex: path.join(over.home, "codex-home") };
  return {
    ...loadConfig({}, false),
    port: 0,
    secrets: "file",
    v1,
    native,
    runtimeSkills: { homes: { home: over.home, ...native }, auto: false },
    updates: "off",
    whatsNew: false,
    news: false,
    app: undefined,
    releases: undefined,
    telemetry: undefined,
    headless: false,
    agentName: "Roby",
    ...over,
  };
}
