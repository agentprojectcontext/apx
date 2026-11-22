import type { DiscoveryFinding, DiscoverySettings } from "@apx/protocol";
import { DISCOVERY_DAY, type DiscoveryRuntime, discoveryState } from "../domain/discovery-state.ts";
import type { Store } from "../domain/store.ts";
import { redactedJson } from "../log.ts";
import type { Llm } from "../providers/llm.ts";
import { discoveryContext, discoveryKey, discoverySources } from "./discovery-context.ts";
import { DISCOVERY_PROMPT, DiscoveryAnswer, findingScore, validateFinding } from "./discovery-findings.ts";
import { discoveryJson } from "./discovery-json.ts";
import { planDiscovery } from "./discovery-plan.ts";
import { type DiscoveryWeb, discoveryWeb, researchDiscoverySource } from "./discovery-research.ts";
import { verifyDiscovery } from "./discovery-verify.ts";

export type DiscoveryCycleDeps = { store: Store; llm: Llm; models: () => string[]; web?: DiscoveryWeb | undefined };
type Cycle = {
  deps: DiscoveryCycleDeps;
  runtime: DiscoveryRuntime;
  settings: DiscoverySettings;
  at: Date;
  signal: AbortSignal;
  valid: () => boolean;
  calls: number;
  operations: number;
};
type Ranked = { finding: DiscoveryFinding; score: number };

async function researchSource(cycle: Cycle, source: DiscoverySettings["sources"][number]): Promise<Ranked[]> {
  const { deps, runtime, settings, signal, at } = cycle;
  const inaccessible: DiscoveryRuntime["inaccessible"] = [];
  const pages = await researchDiscoverySource({
    source,
    web: deps.web ?? discoveryWeb,
    signal,
    take: () => ++cycle.operations <= settings.max_pages,
    failure: (url, reason, kind) => {
      if (inaccessible.length < 40) inaccessible.push({ url, reason, kind });
      if (runtime.inaccessible.length < 40) runtime.inaccessible.push({ url, reason, kind });
    },
  });
  if (!pages.length || !cycle.valid()) return [];
  const reference = discoveryContext(deps.store, settings, source.project, at);
  const previous = runtime.findings.filter((finding) => finding.project === source.project);
  cycle.calls++;
  const answer = await deps.llm.complete({
    models: deps.models().slice(0, 1),
    tools: [],
    once: true,
    signal,
    maxOutputTokens: 2400,
    messages: [
      { role: "system", content: DISCOVERY_PROMPT },
      {
        role: "user",
        content: redactedJson({
          reference,
          question: source.project ? runtime.questions[source.project] : null,
          previous_findings: previous,
          pages,
          inaccessible,
        }),
      },
    ],
  });
  if (answer.usage) deps.store.auxCalls.add({ purpose: "contextual_discovery" }, answer.model, answer.usage);
  signal.throwIfAborted();
  if (!cycle.valid()) return [];
  runtime.coverage[source.project ?? ""] = {
    ...runtime.coverage[source.project ?? ""],
    researched_at: at.toISOString(),
  };
  const proposals = DiscoveryAnswer.parse(discoveryJson(answer.message.content)).findings;
  const result: Ranked[] = [];
  for (const proposal of proposals) {
    const finding = validateFinding(proposal, source.project, pages, at);
    if (!finding || cycle.calls >= settings.max_model_calls) continue;
    const score = findingScore(proposal, finding, runtime, at, settings.cooldown_days, settings.location);
    if (score === undefined) continue;
    cycle.calls++;
    const verified = await verifyDiscovery(
      { llm: deps.llm, models: deps.models(), store: deps.store, signal },
      { proposal, pages, reference, previous, location: settings.location, at: at.toISOString() },
    );
    if (verified && cycle.valid()) result.push({ finding, score });
    signal.throwIfAborted();
  }
  return result;
}

export async function runDiscoveryCycle(
  deps: DiscoveryCycleDeps,
  runtime: DiscoveryRuntime,
  settings: DiscoverySettings,
  at: Date,
  signal: AbortSignal,
  valid: () => boolean,
) {
  const state = discoveryState(deps.store, () => at);
  const cycle: Cycle = { deps, runtime, settings, at, signal, valid, operations: 0, calls: 0 };
  cycle.calls = await planDiscovery({ ...deps, models: deps.models(), signal, valid }, settings, runtime, at);
  if (!valid()) return;
  if (+at < Date.parse(runtime.deep_next)) {
    commitCycle(cycle, [], "completed", false);
    return;
  }
  const sources = discoverySources(deps.store, settings, state.allowed).sort((a, b) =>
    (runtime.source_attempts[discoveryKey(a)] ?? "").localeCompare(runtime.source_attempts[discoveryKey(b)] ?? ""),
  );
  const candidates: Ranked[] = [];
  let failures = 0;
  runtime.inaccessible = [];
  for (const source of sources) {
    signal.throwIfAborted();
    if (!valid() || cycle.calls + 2 > settings.max_model_calls || cycle.operations >= settings.max_pages) break;
    runtime.source_attempts[discoveryKey(source)] = at.toISOString();
    try {
      candidates.push(...(await researchSource(cycle, source)));
    } catch {
      signal.throwIfAborted();
      failures++;
      if (runtime.inaccessible.length < 40)
        runtime.inaccessible.push({
          url: source.pages[0] ?? "search",
          kind: "unverified",
          reason: "Research could not be validated; no finding was accepted from this source",
        });
    }
  }
  if (valid()) commitCycle(cycle, candidates, failures && !candidates.length ? "failed" : "completed", true);
}

function commitCycle(
  { deps, settings, at, runtime }: Cycle,
  ranked: Ranked[],
  result: DiscoveryRuntime["state"],
  deep: boolean,
) {
  const state = discoveryState(deps.store, () => at);
  const live = state.read();
  const findings = live.findings.filter(
    (finding) => state.allowed(finding.project) && +at - Date.parse(finding.found_at) < 30 * DISCOVERY_DAY,
  );
  const topics = new Set(
    findings.filter((finding) => Date.parse(finding.expires_at) > +at).map((finding) => finding.topic),
  );
  const fingerprints = new Set(findings.map((finding) => finding.fingerprint));
  const pool = ranked.filter((candidate) => state.allowed(candidate.finding.project));
  let previous = live.seen.at(-1)?.project;
  for (let n = 0; n < Math.min(7, settings.deep_every_days) && pool.length; n++) {
    pool.sort(
      (a, b) =>
        b.score - (b.finding.project === previous ? 3 : 0) - (a.score - (a.finding.project === previous ? 3 : 0)),
    );
    const candidate = pool.shift();
    if (!candidate || topics.has(candidate.finding.topic) || fingerprints.has(candidate.finding.fingerprint)) {
      n--;
      continue;
    }
    topics.add(candidate.finding.topic);
    fingerprints.add(candidate.finding.fingerprint);
    findings.push(candidate.finding);
    previous = candidate.finding.project;
  }
  state.write({
    ...runtime,
    findings: findings.slice(-100),
    seen: live.seen,
    delivered_days: live.delivered_days,
    claims: live.claims,
    muted: live.muted,
    muted_topics: live.muted_topics,
    feedback: live.feedback,
    state: result,
    ...(deep ? { deep_next: new Date(+at + settings.deep_every_days * DISCOVERY_DAY).toISOString() } : {}),
  });
}
