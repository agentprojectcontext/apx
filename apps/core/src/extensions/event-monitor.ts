import fs from "node:fs";
import { ExtensionEventInput } from "@apx/protocol";
import { z } from "zod";
import type { ExtensionRecord } from "../domain/extensions.ts";
import type { Mcp } from "../mcp/manager.ts";
import { extensionMonitorDir } from "./data.ts";

const Batch = z
  .object({
    events: z.array(ExtensionEventInput).max(10),
    next_poll_seconds: z.number().int().min(30).max(3600).optional(),
    warning: z.literal("source_storage_full").optional(),
  })
  .strict();
type Active = { ext: ExtensionRecord; saved: { generation: string; revision: string } };

/** Polls are bounded MCP calls, not model turns or a second extension process. */
export function createExtensionMonitor(deps: {
  mcp: Pick<Mcp, "find" | "describe" | "observe" | "drop">;
  load: (id: string) => Active | undefined;
  receive: (id: string, input: ExtensionEventInput) => unknown;
  error: (id: string, message: string | null) => void;
  now: () => Date;
}) {
  const polling = new Map<string, { done: Promise<void>; server: string }>();
  const nextPoll = new Map<string, number>();
  const acknowledgments = new Map<string, { revision: string; items: Map<string, { event: string; id: string }> }>();
  let closed = false;
  async function poll(id: string, live: Active) {
    const monitor = live.ext.manifest.monitor;
    if (!monitor) return;
    const current = () =>
      !closed &&
      deps.load(id)?.saved.revision === live.saved.revision &&
      deps.load(id)?.saved.generation === live.saved.generation;
    try {
      fs.mkdirSync(extensionMonitorDir(live.ext), { recursive: true, mode: 0o700 });
      const server = deps.mcp.find("global", `${id}-${monitor.server}`);
      if (!server) throw new Error("No monitor server");
      const tool = (await deps.mcp.describe(server)).find((t) => t.name === monitor.tool);
      if (
        tool?.annotations?.destructiveHint === true ||
        (tool?.annotations?.readOnlyHint !== true &&
          !(monitor.local_state && tool?.annotations?.destructiveHint === false))
      )
        throw new Error("Monitor is not read-only or declared local bookkeeping");
      if (!current()) return;
      let ack = acknowledgments.get(id);
      if (!ack || ack.revision !== live.saved.revision) {
        ack = { revision: live.saved.revision, items: new Map() };
        acknowledgments.set(id, ack);
      }
      const result = await deps.mcp.observe(server, {
        session: live.saved.revision,
        acknowledged: [...ack.items.values()],
      });
      if (!current()) return;
      if (result.isError) throw new Error("Monitor failed");
      const text = (result.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (Buffer.byteLength(text) > 32000) throw new Error("Monitor result too large");
      const batch = Batch.parse(JSON.parse(text));
      ack.items.clear();
      for (const input of batch.events) {
        deps.receive(id, input);
        ack.items.set(JSON.stringify([input.event, input.id]), { event: input.event, id: input.id });
      }
      deps.error(id, batch.warning ? "The observation source is full; queued notices are being recovered" : null);
      nextPoll.set(
        id,
        deps.now().getTime() + Math.min(monitor.every_seconds, batch.next_poll_seconds ?? monitor.every_seconds) * 1000,
      );
    } catch {
      if (!current()) return;
      deps.error(id, "Observation failed; APX will retry without reporting completion");
      nextPoll.set(id, deps.now().getTime() + Math.max(monitor.every_seconds * 1000, 60000));
    }
  }
  async function interrupt(id: string) {
    const running = polling.get(id);
    if (!running) return;
    await deps.mcp.drop({ scope: "global", name: running.server });
    await running.done;
  }
  return {
    async reset(id: string) {
      nextPoll.delete(id);
      acknowledgments.delete(id);
      await interrupt(id);
    },
    tick(id: string) {
      if (closed || polling.has(id)) return;
      const live = deps.load(id);
      const monitor = live?.ext.manifest.monitor;
      if (!live || !monitor || (nextPoll.get(id) ?? 0) > deps.now().getTime()) return;
      const done = poll(id, live).finally(() => polling.delete(id));
      polling.set(id, { done, server: `${id}-${monitor.server}` });
    },
    async close() {
      closed = true;
      await Promise.allSettled([...polling.keys()].map(interrupt));
    },
  };
}
