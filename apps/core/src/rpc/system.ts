import { PROTOCOL_VERSION } from "@apx/protocol";
import type { Identity } from "../identity.ts";
import type { Updates } from "../updates.ts";
import type { Handler, Handlers } from "./router.ts";

export function systemHandlers(
  identity: Identity,
  panel: () => string | undefined,
  subsystems: () => Record<string, { status: "ok" | "degraded" | "down" | "off"; detail?: string }>,
) {
  const health: Handler<"system.health"> = () => ({
    name: "apx-core",
    version: identity.version,
    code_sha: identity.code_sha,
    home_id: identity.home_id,
    protocol: PROTOCOL_VERSION,
    started_at: identity.started_at.toISOString(),
    uptime_s: Math.round((Date.now() - identity.started_at.getTime()) / 1000),
    rss_mb: Math.round(process.memoryUsage.rss() / 1048576),
    subsystems: subsystems(),
    ...(panel() ? { panel: panel() } : {}),
  });
  const ping: Handler<"system.ping"> = ({ echo }) => ({ pong: echo ?? "pong", at: new Date().toISOString() });
  return { "system.health": health, "system.ping": ping };
}

/** Whether a newer APX is out, and bringing it in on the owner's word. */
export function updateHandlers(updates: Updates) {
  return {
    "system.updates": async ({ check }) => (check ? await updates.check() : updates.status()),
    "system.update": () => updates.apply(),
  } satisfies Partial<Handlers>;
}
