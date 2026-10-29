// The mail check: a background check on the office clock, turned on and timed in Gmail's settings. It asks Gmail's
// history (free) what reached the inbox; only mail outside ads, social and lists (and, if the owner chose, only what
// Gmail marks important) reaches the super-agent in Home, as data, to tell the owner or answer SKIP.
// See DECISIONS.md#d-135 and #d-171
import { quietNow } from "../domain/notices.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { untrusted } from "../tools/result.ts";
import type { BackgroundCheck } from "./background.ts";
import type { AdmitFn } from "./engine.ts";

/** A mail as the check sees it: who, what, and Gmail's labels (IMPORTANT, CATEGORY_PROMOTIONS…). */
export type MailArrival = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
};

/** The owner's Gmail; `readable` is false while it cannot be read (not connected, or APX's send-only client). */
export type MailSource = {
  readable(): boolean;
  historyId(): Promise<string>;
  /** What reached the inbox after `from`, and where to ask from next; undefined when that point is too old. */
  arrived(from: string): Promise<{ next: string; mail: MailArrival[] } | undefined>;
};

/** Gmail's tabs the check never reads: ads, social networks, mailing lists, spam. */
const UNREAD_TABS = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "SPAM", "TRASH", "SENT"]);
const SEEN_KEY = "mail_seen";
/** The clock beats each minute; a check due within this slack of its time runs at this beat, not the next one. */
const SLACK_MS = 30_000;

/** The mail worth a look, one line each, for the super-agent to judge. */
export function mailLines(mail: MailArrival[]): string {
  return mail
    .map((m) =>
      JSON.stringify({
        id: m.id,
        from: m.from,
        subject: m.subject,
        date: m.date,
        snippet: m.snippet.slice(0, 300),
        ...(m.labels.includes("IMPORTANT") ? { gmail_important: true } : {}),
      }),
    )
    .join("\n");
}

/** The mail a check passes on: never the skipped tabs; only Gmail's important ones when the owner chose so. */
export const worthTelling = (mail: readonly MailArrival[], importantOnly: boolean): MailArrival[] =>
  mail.filter((m) => !m.labels.some((l) => UNREAD_TABS.has(l)) && (!importantOnly || m.labels.includes("IMPORTANT")));

export function mailCheck(deps: { store: Store; source: MailSource; admit: AdmitFn }): BackgroundCheck {
  const { store, source } = deps;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    id: "mail-check",
    everyMs: 60_000,
    run: async (at) => {
      const { enabled, every_min, important_only } = store.settings.read("mail_check");
      if (!enabled || !source.readable()) return;
      if (at.getTime() - lastAt < every_min * 60_000 - SLACK_MS) return;
      // In quiet hours it waits without moving its point: the first check after sees what came meanwhile.
      if (quietNow(store, at)) return;
      lastAt = at.getTime();
      const from = store.settings.get(SEEN_KEY);
      // The first check starts from now; Gmail not answering keeps the point, so nothing is lost.
      const got = from ? await source.arrived(from) : undefined;
      store.settings.set(SEEN_KEY, got ? got.next : await source.historyId());
      const worth = worthTelling(got?.mail ?? [], important_only);
      const boss = store.agents.list().find((a) => a.kind === "secretary");
      if (!worth.length || !boss || !store.threads.get(HOME_THREAD_ID)) return;
      deps.admit({
        thread_id: HOME_THREAD_ID,
        agent_id: boss.id,
        trigger: "system",
        origin: { kind: "mail", count: worth.length },
        text: untrusted("emails", { count: String(worth.length) }, mailLines(worth)),
      });
    },
  };
}
