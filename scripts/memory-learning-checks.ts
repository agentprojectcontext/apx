import { duplicateMemory } from "../apps/core/src/domain/memory-content.ts";
import type { LearningScenario, learningWorld } from "../apps/core/src/engine/memory-learning-world.ts";
import type { startCore } from "../apps/core/src/engine/testkit.ts";
import type { Memory } from "../packages/protocol/src/index.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
export type LearningChecks = {
  failures: string[];
  sources: unknown[];
  probes?: unknown[];
  fixtures?: unknown;
};
export function privateSnapshotLeaks(snapshots: unknown[], notes: Memory[]): boolean {
  const text = JSON.stringify(snapshots);
  return notes.some((n) => text.includes(n.id) || n.evidence?.some((e) => text.includes(e.message_id)));
}
export async function checkIsolation(
  env: Env,
  targets: Array<{ boundary: string; thread: string }>,
  world: ReturnType<typeof learningWorld>,
  notes: Memory[],
  result: LearningChecks,
  send: (env: Env, thread: string, text: string) => Promise<unknown>,
) {
  result.probes = [];
  for (const { boundary, thread } of targets) {
    const before = world.deliveries.length;
    await send(
      env,
      thread,
      "Elegí etiqueta para informe interno nuevo. Si no conocés preferencia duradera autorizada para vos, elegí NEUTRO. Guardá mediante deliver_report con label, sin pedir aclaración.",
    );
    const snapshots = env.core.store.modelLog
      .list(thread)
      .filter((e) => e.memory)
      .map((e) => e.memory);
    const label = world.deliveries.at(-1)?.label;
    if (world.deliveries.length === before || String(label).toUpperCase() !== "NEUTRO")
      result.failures.push(`private owner memory crossed ${boundary} boundary`);
    if (privateSnapshotLeaks(snapshots, notes))
      result.failures.push(`private owner memory entered ${boundary} snapshot`);
    result.probes.push({ boundary, thread, label, snapshots });
    result.sources.push(...snapshots);
  }
}
export async function seedIndexNoise(env: Env, scenario: LearningScenario, agent: string, project: string) {
  const ids: string[] = [];
  for (let i = 0; i < (scenario.noiseNotes ?? 0); i++) {
    const note = await env.client.call("memory.add", {
      scope: "agent",
      agent,
      project,
      text: `Synthetic index-load fixture ${i}: warehouse shelf ${i} has horizontal partitions; unrelated to reports or their labels.`,
    });
    ids.push(note.id);
  }
  return { kind: "synthetic-index-load", ids, count: ids.length, learned: false };
}
export function checkCorrectionTrace(env: Env, scenario: LearningScenario, notes: Memory[], result: LearningChecks) {
  if (scenario.id !== 7) return;
  const versions = notes.flatMap((n) => [n, ...env.core.store.memories.history(n.id).map((v) => v.note)]);
  for (const label of ["CUARZO", "JADE"]) {
    if (
      !versions.some(
        (n) =>
          n.source === "agent" &&
          n.evidence?.some((e) => {
            const m = env.core.store.messages.get(e.message_id);
            return e.quote.includes(label) && m?.author.kind === "user" && JSON.stringify(m.parts).includes(e.quote);
          }),
      )
    )
      result.failures.push(`correction lacks owner-source trace for ${label}`);
  }
}
export function checkDreamPreservation(env: Env, before: Memory[], after: Memory[], result: LearningChecks) {
  const expected = before.filter((n) => n.scope === "agent" && /JADE/.test(n.text));
  if (!expected.length) result.failures.push("no original private note to test dream preservation");
  for (const n of expected) {
    const history = env.core.store.memories.history(n.id);
    const merged = history.findLast((v) => v.reason.startsWith("dream:"));
    const keep = merged?.reason.split(":")[1];
    const preserved = after.find((a) => a.id === (keep ?? n.id));
    if (
      !preserved ||
      !duplicateMemory(preserved.text, n.text) ||
      n.evidence?.some((e) => !preserved.evidence?.some((p) => p.message_id === e.message_id && p.quote === e.quote))
    )
      result.failures.push("unrelated dream pass lost the original assertion or its sources");
    if (history.some((v) => /superseded:|stale/.test(v.reason)))
      result.failures.push("unrelated dream pass retired the original note");
  }
}
export function checkDelegationPayload(
  env: Env,
  world: ReturnType<typeof learningWorld>,
  result: LearningChecks,
  runs: Set<string>,
) {
  const route = world.originalRoute;
  const payloads = env.core.store.threads.list({ include_subthreads: true, limit: null }).flatMap((t) =>
    env.core.store.runs
      .list(t.id)
      .filter((r) => runs.has(r.id))
      .flatMap((r) =>
        env.core.store.runs
          .steps(r.id)
          .filter((s) => {
            if (s.tool !== "delegate" || s.state !== "ok" || typeof s.args.agent !== "string") return false;
            const recipient = env.core.store.agents.resolve(s.args.agent, t.project_id);
            return !("error" in recipient) && recipient.agent.slug === "producer";
          })
          .map((s) => (typeof s.args.task === "string" ? s.args.task : "")),
      ),
  );
  if (!route || !payloads.some((p) => p.includes(route) && p.includes("prepare_asset") && p.includes("inspect_asset")))
    result.failures.push("delegation did not transmit the known route and verification method to the producer");
}
export function deadlineDay(at: string, zone: string) {
  const local = new Date(at).toLocaleDateString("en-CA", { timeZone: zone });
  return new Date(Date.parse(`${local}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}
