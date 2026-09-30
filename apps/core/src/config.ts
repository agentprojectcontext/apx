// One config loader, injected everywhere (no import-time singletons).
import os from "node:os";
import path from "node:path";

export type CoreConfig = {
  host: string;
  port: number;
  /** State home. v2 lives beside v1 (~/.apx) until the cut-over. */
  home: string;
  /** Required whenever host is not loopback. */
  token: string | undefined;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const config: CoreConfig = {
    host: env.APX_HOST ?? "127.0.0.1",
    port: Number(env.APX_PORT ?? 7440),
    home: env.APX_HOME ?? path.join(os.homedir(), ".apx2"),
    token: env.APX_TOKEN || undefined,
  };
  assertSafeBind(config);
  return config;
}

export function assertSafeBind(config: Pick<CoreConfig, "host" | "token">): void {
  if (!LOOPBACK.has(config.host) && !config.token) {
    throw new Error(`refusing to listen on ${config.host} without APX_TOKEN`);
  }
}
