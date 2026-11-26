import type { DiscoveryFinding } from "@apx/protocol";
import { DISCOVERY_DAY, discoveryState } from "./discovery-state.ts";
import { ownerIdentity, ownerTimeZone } from "./owner.ts";
import type { Store } from "./store.ts";

/** The owner's profile time zone decides a report's day; the research setting only covers an owner who set none. */
export function discoveryTimeZone(store: Store): string {
  return ownerTimeZone(store) ?? store.settings.read("discovery").timezone;
}

export function discoveryReportTarget(store: Store, routine: string) {
  const settings = store.settings.read("discovery");
  const target = store.routines.get(routine);
  return (
    settings.enabled &&
    settings.delivery === "routine" &&
    settings.report_routine === routine &&
    target &&
    !target.project_id &&
    target.action === "agent" &&
    store.agents.get(target.agent_id)?.kind === "secretary"
  );
}

/** Inside routine admission's transaction: a rejected admission rolls back the single-use reservation too. */
export function reserveDiscoveryReport(store: Store, routine: string, run: string, at: Date): void {
  if (!discoveryReportTarget(store, routine)) return;
  const state = discoveryState(store, () => at);
  const runtime = state.read();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: discoveryTimeZone(store),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  if (runtime.delivered_days.includes(day) || runtime.claims.some((claim) => claim.run === run)) return;
  const finding = runtime.findings.find(
    (f) =>
      !f.reserved_at &&
      f.feedback !== "not_useful" &&
      f.feedback !== "mute" &&
      !runtime.muted.includes(f.topic) &&
      state.allowed(f.project) &&
      Date.parse(f.expires_at) > +at,
  );
  if (!finding) return;
  finding.reserved_at = at.toISOString();
  runtime.claims = [...runtime.claims, { routine, run, finding: finding.id, composed: false }].slice(-100);
  runtime.delivered_days = [...runtime.delivered_days, day].slice(-100);
  runtime.seen = [
    ...runtime.seen.filter((s) => +at - Date.parse(s.at) < 90 * DISCOVERY_DAY),
    {
      topic: finding.topic,
      fingerprint: finding.fingerprint,
      at: at.toISOString(),
      ...(finding.project ? { project: finding.project } : {}),
    },
  ].slice(-500);
  state.write(runtime);
}

/** One deterministic appendix on the report's actual outgoing path, not instructions for a model to repeat. */
export function composeDiscoveryReport(store: Store, run: string, body: string, at: Date): string {
  return store.tx(() => {
    const state = discoveryState(store, () => at);
    const runtime = state.read();
    const claim = runtime.claims.find((item) => item.run === run && !item.composed);
    if (!claim || !discoveryReportTarget(store, claim.routine)) return body;
    const finding = runtime.findings.find((item) => item.id === claim.finding);
    if (
      !finding ||
      !state.allowed(finding.project) ||
      finding.feedback === "not_useful" ||
      runtime.muted.includes(finding.topic) ||
      Date.parse(finding.expires_at) <= +at
    )
      return body;
    claim.composed = true;
    finding.included_at = at.toISOString();
    state.write(runtime);
    const en = ownerIdentity(store).language === "en";
    return [body.trim(), findingText(finding, en ? "Worth a look" : "Para tener en cuenta"), feedbackLine(en)]
      .filter(Boolean)
      .join("\n\n");
  });
}

/** A finding as the owner reads it: what, why, what to do, what is not established and where it was read. */
export function findingText(finding: DiscoveryFinding, label?: string): string {
  const sources = [
    ...new Set(finding.evidence.map((item) => `${item.title}: ${item.url} (${item.read_at.slice(0, 10)})`)),
  ].join("\n");
  return [
    `${label ? `${label}\n` : ""}${finding.title}\n${finding.summary}\n${finding.action}`,
    finding.uncertainty,
    sources,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const feedbackLine = (en: boolean) =>
  en ? "You can reply: Useful, Not useful, or Mute topic." : "Podés responder: Útil, No útil o Silenciar tema.";
