// Automatic delivery of research findings (DECISIONS.md#d-278): one that cannot wait is told at once, the rest together
// in one short summary at the start of the owner's day, in their time zone. Both are the super-agent's words in its home
// chat, sent on to the owner the way routines reach them. Part of research's background check (DECISIONS.md#d-171).
import type { DiscoveryFinding } from "@apx/protocol";
import { postAgentWords } from "../domain/agent-words.ts";
import type { Presentation } from "../domain/channels.ts";
import { discoveryTimeZone, feedbackLine, findingText } from "../domain/discovery-report.ts";
import { DISCOVERY_DAY, discoveryState } from "../domain/discovery-state.ts";
import { ownerIdentity } from "../domain/owner.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";

/** The owner's day starts here (local hour); the summary goes out on the first check after it. */
const DIGEST_HOUR = 8;
/** A summary stays short: the best few, the rest wait for the next morning while they are still current. */
const DIGEST_MAX = 3;

export type NotifyOwner = (body: Presentation, threadId: string, messageId: string) => unknown;

function localDay(at: Date, zone: string): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function deliverDiscovery(store: Store, notify: NotifyOwner | undefined, at: Date): void {
  const settings = store.settings.read("discovery");
  if (!settings.enabled || settings.delivery !== "automatic") return;
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  if (!boss || !store.threads.get(HOME_THREAD_ID)) return;
  const state = discoveryState(store, () => at);
  const runtime = state.read();
  const waiting = runtime.findings.filter(
    (f) =>
      !f.included_at &&
      !f.reserved_at &&
      f.feedback !== "not_useful" &&
      f.feedback !== "mute" &&
      !runtime.muted.includes(f.topic) &&
      state.allowed(f.project) &&
      Date.parse(f.expires_at) > +at,
  );
  const now = waiting.filter((f) => f.urgency === "now");
  const { day, hour } = localDay(at, discoveryTimeZone(store));
  const morning = hour >= DIGEST_HOUR && !runtime.digest_days.includes(day);
  const digest = morning ? waiting.filter((f) => f.urgency !== "now").slice(0, DIGEST_MAX) : [];
  if (!now.length && !morning) return;
  const en = ownerIdentity(store).language === "en";
  const told: DiscoveryFinding[] = [];
  const say = (findings: DiscoveryFinding[], label: string) => {
    const text = [label, ...findings.map((f) => findingText(f)), feedbackLine(en)].join("\n\n");
    const messageId = postAgentWords(store, {
      thread_id: HOME_THREAD_ID,
      agent_id: boss.id,
      text,
      // The ids let a reply about one of them become its feedback.
      note: `<system_note>\nYou told the owner what research found: ${findings.map((f) => `${f.id} "${f.title}"`).join("; ")}. A reply about one is feedback for discovery.feedback.\n</system_note>`,
      unread: true,
    });
    notify?.({ text }, HOME_THREAD_ID, messageId);
    told.push(...findings);
  };
  if (now.length) say(now, en ? "This one is worth a look today:" : "Esto conviene mirarlo hoy:");
  if (digest.length) say(digest, en ? "What research found:" : "Lo que encontró la investigación:");
  const ids = new Set(told.map((f) => f.id));
  for (const f of runtime.findings) if (ids.has(f.id)) f.included_at = at.toISOString();
  runtime.seen = [
    ...runtime.seen.filter((s) => +at - Date.parse(s.at) < 90 * DISCOVERY_DAY),
    ...told.map((f) => ({
      topic: f.topic,
      fingerprint: f.fingerprint,
      at: at.toISOString(),
      ...(f.project ? { project: f.project } : {}),
    })),
  ].slice(-500);
  if (morning) runtime.digest_days = [...runtime.digest_days, day].slice(-100);
  state.write(runtime);
}
