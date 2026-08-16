import { useNavigate } from "react-router-dom";
import { Section } from "../components/Section";
import { Badge, Button, Empty, Loading } from "../components/ui";
import { useInbox } from "../hooks/useInbox";
import type { InboxRow } from "../lib/api/inbox";
import { t } from "../i18n";
import { useState } from "react";

/**
 * The agent inbox — every agent as a conversation, most recent first.
 *
 * A SECOND AXIS over the same data, not a replacement for project navigation:
 * this is the conversational way in, the project rail is the structural one.
 * Clicking a row opens that agent's existing chat rather than re-implementing
 * one here — the thread UI already exists and must not be forked.
 */
export function InboxScreen() {
  const navigate = useNavigate();
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const { rows, isLoading } = useInbox(includeEmpty);

  const open = (row: InboxRow) => {
    if (row.kind === "super_agent") {
      navigate("/p/0/chat");
      return;
    }
    navigate(`/p/${row.project_id}/agents/${encodeURIComponent(row.agent_slug)}`);
  };

  return (
    <Section
      fullHeight
      title={t("inbox.title")}
      description={t("inbox.subtitle")}
      action={
        <Button size="sm" variant={includeEmpty ? "primary" : "ghost"} onClick={() => setIncludeEmpty((v) => !v)}>
          {t("inbox.show_quiet")}
        </Button>
      }
    >
      {isLoading ? <Loading /> : null}
      {!isLoading && rows.length === 0 ? <Empty>{t("inbox.empty")}</Empty> : null}

      <ul className="space-y-2" data-testid="inbox-list">
        {rows.map((row) => (
          <li key={`${row.project_id ?? "global"}-${row.agent_slug}`}>
            <button
              type="button"
              data-testid={`inbox-row-${row.agent_slug}`}
              onClick={() => open(row)}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition ${
                row.pinned
                  ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              }`}
            >
              <span className="mt-0.5 text-lg leading-none">{row.agent_emoji || "🤖"}</span>

              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-medium">{row.agent_name || row.agent_slug}</span>
                  {row.pinned ? <Badge tone="info">{t("inbox.pinned")}</Badge> : null}
                  {/* On a phone the timestamp rides with the name; there is no
                      room for a third column. */}
                  <span className="ml-auto shrink-0 text-xs opacity-50 sm:hidden">
                    {shortTime(row.last_activity_at)}
                  </span>
                </span>

                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs opacity-55">
                  {row.project_name ? <span className="truncate">{row.project_name}</span> : null}
                  {row.channel ? <span className="opacity-70">· {row.channel}</span> : null}
                </span>

                {/* The agent's own last line. Echoing the user's prompt back
                    would tell them nothing they do not already know. Two lines
                    on a phone, one on a wide screen. */}
                <span className="mt-1 block line-clamp-2 text-sm leading-snug opacity-75 sm:line-clamp-1">
                  {row.preview || t("inbox.no_reply_yet")}
                </span>
              </span>

              <span className="hidden shrink-0 text-xs opacity-50 sm:block">
                {shortTime(row.last_activity_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Today → time of day; older → date. Same idea as a messaging app. */
function shortTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}
