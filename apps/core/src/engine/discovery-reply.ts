import { discoveryReportTarget } from "../domain/discovery-report.ts";
import { discoveryState } from "../domain/discovery-state.ts";
import type { Store } from "../domain/store.ts";
import { untrusted } from "../tools/result.ts";

export function discoveryReplyContext(store: Store, thread: string, agent: string): string | undefined {
  const chat = store.threads.get(thread);
  if (chat?.kind !== "routine" || chat.project_id) return;
  const state = discoveryState(store, () => new Date());
  const runtime = state.read();
  const claim = [...runtime.claims]
    .reverse()
    .find(
      (item) =>
        item.composed &&
        store.runs.get(item.run)?.thread_id === thread &&
        store.routines.get(item.routine)?.agent_id === agent &&
        discoveryReportTarget(store, item.routine),
    );
  if (!claim) return;
  const finding = runtime.findings.find((item) => item.id === claim.finding && state.allowed(item.project));
  if (!finding) return;
  return `APX: this report has a contextual research finding. If the owner explicitly rates or mutes its topic, load apx_settings with tool_search and use discovery.feedback with finding ${JSON.stringify(finding.id)} and feedback useful, not_useful, mute or unmute. A general memory does not change research feedback. Do not rate it without the owner's request.\n${untrusted("research_finding", { finding: finding.id }, JSON.stringify({ title: finding.title, summary: finding.summary, feedback: finding.feedback ?? null, sources: finding.evidence.map((item) => item.url) }))}`;
}
