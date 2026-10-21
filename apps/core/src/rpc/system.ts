import { PROTOCOL_VERSION } from "@apx/protocol";
import { coreLogFile, readCoreLog } from "../core-log.ts";
import type { Identity } from "../identity.ts";
import type { News } from "../news/news.ts";
import type { Telemetry } from "../telemetry.ts";
import type { Updates } from "../updates.ts";
import type { Handler, Handlers } from "./router.ts";

export function systemHandlers(
  identity: Identity,
  home: string,
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
  const logs: Handler<"system.logs"> = ({ limit, level, scope, q }) => {
    const file = coreLogFile(home);
    return { path: file, ...readCoreLog(file, { limit, level, scope, q }) };
  };
  return { "system.health": health, "system.ping": ping, "system.logs": logs };
}

/** Whether a newer APX is out, and bringing it in on the owner's word. */
export function updateHandlers(updates: Updates) {
  return {
    "system.updates": async ({ check }) => (check ? await updates.check() : updates.status()),
    "system.update": () => updates.apply(),
  } satisfies Partial<Handlers>;
}

/** What this install reports about itself, and the owner's answer on usage statistics. */
export function telemetryHandlers(telemetry: Telemetry) {
  return {
    "telemetry.get": () => telemetry.get(),
    "telemetry.set": ({ usage }) => telemetry.set(usage),
    "telemetry.seen": () => {
      telemetry.seen();
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}

/** Release news: what there is, and telling it now (a replay for testing, or what a start would tell). */
export function newsHandlers(news: Pick<News, "list" | "tell">) {
  return {
    "system.news": () => ({ entries: news.list() }),
    "system.news_tell": ({ ids }) => news.tell(ids),
  } satisfies Partial<Handlers>;
}
