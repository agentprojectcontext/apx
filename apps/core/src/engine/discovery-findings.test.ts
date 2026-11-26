import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiscoveryRuntime } from "../domain/discovery-state.ts";
import { DiscoveryAnswer, type DiscoveryProposal, findingScore, validateFinding } from "./discovery-findings.ts";

const at = new Date("2026-05-01T12:00:00.000Z");
const page = {
  url: "https://example.com/news",
  title: "Acme news",
  text: "Acme announced a new export format.",
  read_at: at.toISOString(),
};
const proposal: DiscoveryProposal = {
  topic: "Acme export format",
  title: "A useful new export format",
  summary: "A format relevant to your planned export workflow.",
  action: "Compare the format with your requirements.",
  uncertainty: "Compatibility is untested.",
  expires_at: "2026-05-07T12:00:00.000Z",
  relevance: 4,
  impact: 4,
  novelty: 4,
  actionable: 4,
  timely: 3,
  local: 0,
  evidence: [{ page: 0, quote: page.text }],
};
const runtime = (): DiscoveryRuntime => ({
  next: at.toISOString(),
  deep_next: at.toISOString(),
  state: "waiting",
  coverage: {},
  source_attempts: {},
  snapshots: {},
  questions: {},
  plan_attempts: {},
  findings: [],
  muted: [],
  muted_topics: [],
  inaccessible: [],
  delivered_days: [],
  claims: [],
  seen: [],
  feedback: {},
});

test("validation rejects fabricated evidence and expiry, and deduplicates the same public finding across projects", () => {
  const valid = validateFinding(proposal, "acme", [page], at);
  const same = validateFinding({ ...proposal, title: "A differently worded headline" }, "northwind", [page], at);
  assert.ok(valid && same);
  assert.equal(valid.topic, same.topic);
  assert.equal(valid.fingerprint, same.fingerprint);
  assert.equal(
    validateFinding({ ...proposal, evidence: [{ page: 1, quote: page.text }] }, "acme", [page], at),
    undefined,
  );
  assert.equal(validateFinding({ ...proposal, expires_at: at.toISOString() }, "acme", [page], at), undefined);
  assert.equal(validateFinding({ ...proposal, expires_at: "2026-07-01T12:00:00.000Z" }, "acme", [page], at), undefined);
  const state = runtime();
  state.findings.push(valid);
  assert.equal(findingScore(proposal, same, state, at, 14, ""), undefined);
});

test("quotation checks normalize layout whitespace but never accept stitched or changed words", () => {
  assert.ok(validateFinding(proposal, "acme", [{ ...page, text: "Acme\n\nannounced a\tnew export format." }], at));
  assert.equal(
    validateFinding(
      { ...proposal, evidence: [{ page: 0, quote: "Acme announced export format." }] },
      "acme",
      [page],
      at,
    ),
    undefined,
  );
  assert.equal(
    validateFinding(
      { ...proposal, evidence: [{ page: 0, quote: "Acme announced a new import format." }] },
      "acme",
      [page],
      at,
    ),
    undefined,
  );
  const text = `${page.text}\nThis paragraph must not be silently omitted.\nIt supports portable data.`;
  assert.equal(
    validateFinding(
      { ...proposal, evidence: [{ page: 0, quote: `${page.text}\nIt supports portable data.` }] },
      "acme",
      [{ ...page, text }],
      at,
    ),
    undefined,
  );
});

test("thresholds, persistent cooldown and feedback affect selection without forcing weak topics", () => {
  const candidate = validateFinding(proposal, "acme", [page], at);
  assert.ok(candidate);
  const state = runtime();
  const normal = findingScore(proposal, candidate, state, at, 14, "");
  assert.equal(typeof normal, "number");
  assert.equal(findingScore({ ...proposal, novelty: 1 }, candidate, state, at, 14, ""), undefined);
  state.feedback[candidate.topic] = "useful";
  assert.equal(findingScore(proposal, candidate, state, at, 14, ""), (normal ?? 0) + 2);
  state.feedback[candidate.topic] = "not_useful";
  assert.equal(findingScore(proposal, candidate, state, at, 14, ""), (normal ?? 0) - 10);
  state.muted.push(candidate.topic);
  assert.equal(findingScore(proposal, candidate, state, at, 14, ""), undefined);
  state.muted = [];
  state.seen.push({ topic: candidate.topic, at: at.toISOString() });
  assert.equal(findingScore(proposal, candidate, state, at, 14, ""), undefined);
});

test("a finding quoting more than four excerpts keeps four instead of being dropped", () => {
  const quotes = ["Acme announced", "a new export", "export format", "new export format", "Acme announced a new"];
  const answer = DiscoveryAnswer.parse({
    findings: [{ ...proposal, evidence: quotes.map((quote) => ({ page: 0, quote })) }],
  });
  const [kept] = answer.findings;
  assert.ok(kept);
  assert.equal(kept.evidence.length, 4);
  assert.equal(validateFinding(kept, "acme", [page], at)?.evidence.length, 4);
});
