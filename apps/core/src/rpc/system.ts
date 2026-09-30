import { PROTOCOL_VERSION } from "@apx/protocol";
import type { Identity } from "../identity.ts";
import type { Handler } from "./router.ts";

export function systemHandlers(
  identity: Identity,
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
    subsystems: subsystems(),
  });
  const ping: Handler<"system.ping"> = ({ echo }) => ({ pong: echo ?? "pong", at: new Date().toISOString() });
  return { "system.health": health, "system.ping": ping };
}
