// One config loader, injected everywhere (no import-time singletons, no process.env reads elsewhere).
import os from "node:os";
import path from "node:path";

export type ProviderTransport = "openai-chat" | "anthropic-messages";

/** A model API. `key` is a reference (secret://name or env:VAR), never the value. */
export type ProviderConfig = {
  id: string;
  transport: ProviderTransport;
  base_url: string;
  key: string;
  /** Tried in order when the agent does not name a model. */
  models: string[];
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
  providers: ProviderConfig[];
  /** Silence before the first byte of a model answer. */
  llmTimeoutMs: number;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "gemini",
    transport: "openai-chat",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: "secret://gemini",
    models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
  },
  {
    id: "anthropic",
    transport: "anthropic-messages",
    base_url: "https://api.anthropic.com",
    key: "secret://anthropic",
    models: ["claude-sonnet-5-5"],
  },
  {
    id: "openai",
    transport: "openai-chat",
    base_url: "https://api.openai.com/v1",
    key: "secret://openai",
    models: [],
  },
];

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  // APX_LLM_* puts one custom OpenAI-compatible provider first (local models, tests, other gateways).
  const custom: ProviderConfig[] = env.APX_LLM_BASE_URL
    ? [
        {
          id: "custom",
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
    home: env.APX_HOME ?? path.join(os.homedir(), ".apx2"),
    token: env.APX_TOKEN || undefined,
    allowedOrigins: list(env.APX_ALLOWED_ORIGINS),
    webDist: env.APX_WEB_DIST || undefined,
    v1: { url: env.APX_V1_URL ?? "http://127.0.0.1:7430", home: env.APX_V1_HOME ?? path.join(os.homedir(), ".apx") },
    providers: [...custom, ...DEFAULT_PROVIDERS],
    llmTimeoutMs: Number(env.APX_LLM_TIMEOUT_MS ?? 45_000),
  };
  assertSafeBind(config);
  return config;
}

export function assertSafeBind(config: Pick<CoreConfig, "host" | "token">): void {
  if (!LOOPBACK.has(config.host) && !config.token) {
    throw new Error(`refusing to listen on ${config.host} without APX_TOKEN`);
  }
}

/** Config for tests and embedders: defaults plus overrides, no environment. */
export function testConfig(over: Partial<CoreConfig> & { home: string }): CoreConfig {
  return { ...loadConfig({}), port: 0, ...over };
}
