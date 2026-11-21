import { ExtensionEventConfig, ExtensionEventInput } from "@apx/protocol";
import { extensionGeneration } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { InternalCall } from "../rpc/internal.ts";
import { createExtensionMonitor } from "./event-monitor.ts";
import { extensionEventTarget, extensionEventTargets } from "./event-targets.ts";
import type { Extensions } from "./extensions.ts";

export function eventQuiet(config: ExtensionEventConfig, at: Date): boolean {
  if (config.quiet_start === config.quiet_end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.time_zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const minute =
    Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
  return config.quiet_start < config.quiet_end
    ? minute >= config.quiet_start && minute < config.quiet_end
    : minute >= config.quiet_start || minute < config.quiet_end;
}

/** Observations enter the router as outside data; receipt admission is atomic with the run. */
export function createExtensionEvents(deps: {
  store: Store;
  extensions: Pick<Extensions, "approved">;
  mcp: Pick<Mcp, "find" | "describe" | "observe" | "drop">;
  internal: InternalCall;
  now?: () => Date;
}) {
  const { store } = deps;
  const repo = store.extensionEvents;
  const now = deps.now ?? (() => new Date());
  let closed = false;
  let flushing: Promise<void> | undefined;
  function active(id: string) {
    const ext = deps.extensions.approved(id);
    const saved = repo.config(id);
    if (!ext || !saved?.config.enabled || saved.generation !== extensionGeneration(ext)) return undefined;
    return { ext, saved };
  }
  const target = (thread: string) => extensionEventTarget(store, thread);
  async function configure(id: string, raw: ExtensionEventConfig) {
    const config = ExtensionEventConfig.parse(raw);
    const ext = config.enabled ? deps.extensions.approved(id) : store.extensions.get(id);
    if (!ext) throw conflict("Enable an unchanged extension first");
    if (config.enabled && !ext.manifest.events?.length) throw badRequest("The extension declares no events");
    if (config.enabled) target(config.thread);
    try {
      new Intl.DateTimeFormat("en", { timeZone: config.time_zone }).format(now());
    } catch {
      throw badRequest("Choose a valid time zone");
    }
    store.tx(() => {
      repo.cancel(id);
      repo.configure(id, extensionGeneration(ext), config);
    });
    await monitor.reset(id);
    return { ok: true };
  }
  function emit(id: string, raw: ExtensionEventInput) {
    const input = ExtensionEventInput.parse(raw);
    const live = active(id);
    if (!live) throw conflict("Extension notices are off or need approval again");
    if (!live.ext.manifest.events?.some((e) => e.name === input.event)) throw badRequest("Unknown extension event");
    target(live.saved.config.thread);
    const at = now();
    return store.tx(() => {
      repo.compact(new Date(at.getTime() - 86400000).toISOString(), id);
      const old = repo.find(id, live.saved.generation, input);
      if (old) return { receipt: old.receipt, duplicate: true };
      if (repo.count(id) >= 10000) throw conflict("Extension event storage is full");
      if (repo.count(id, new Date(at.getTime() - 60000).toISOString()) >= 60)
        throw conflict("Extension event rate limit reached");
      return {
        receipt: repo.add(
          id,
          live.saved.generation,
          live.saved.revision,
          live.saved.config.thread,
          input,
          at.toISOString(),
        ),
        duplicate: false,
      };
    });
  }
  const monitor = createExtensionMonitor({ mcp: deps.mcp, load: active, receive: emit, error: repo.error, now });
  async function flush() {
    repo.expire(new Date(now().getTime() - 7 * 86400000).toISOString());
    repo.compact(new Date(now().getTime() - 86400000).toISOString());
    for (const item of store.extensions.list().flatMap((ext) => repo.pending(ext.id))) {
      if (closed) return;
      const live = active(item.extension);
      if (
        !live ||
        live.saved.generation !== item.generation ||
        live.saved.config.thread !== item.thread ||
        live.saved.revision !== item.revision
      ) {
        repo.cancel(item.extension);
        continue;
      }
      if (eventQuiet(live.saved.config, now())) continue;
      try {
        target(item.thread);
        await deps.internal(
          "threads.send",
          {
            thread: item.thread,
            text: JSON.stringify({
              extension: item.extension,
              event: item.event,
              id: item.external_id,
              data: JSON.parse(item.data),
            }),
            mode: "queue",
          },
          {
            actor: "agent",
            extensionEvent: { extension: item.extension, generation: item.generation, receipt: item.receipt },
          },
          `extension-event:${item.receipt}`,
        );
        repo.error(item.extension, null);
      } catch {
        repo.error(item.extension, "Notice delivery failed; APX will retry");
      }
    }
  }
  return {
    configure,
    emit,
    get(id: string) {
      if (!store.extensions.get(id)) throw notFound("Extension");
      const saved = repo.config(id);
      return {
        ...(saved ? { config: { ...saved.config, enabled: Boolean(active(id)) } } : {}),
        pending: repo.pendingCount(id),
        targets: extensionEventTargets(store),
        ...(saved?.error ? { error: saved.error } : {}),
      };
    },
    tick() {
      if (closed) return;
      for (const ext of store.extensions.list()) {
        if (!active(ext.id)) {
          repo.cancel(ext.id);
          continue;
        }
        monitor.tick(ext.id);
      }
      if (!flushing)
        flushing = flush().finally(() => {
          flushing = undefined;
        });
    },
    async close() {
      closed = true;
      await monitor.close();
      await flushing;
    },
  };
}
export type ExtensionEvents = ReturnType<typeof createExtensionEvents>;
