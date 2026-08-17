import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, EyeOff, Eye } from "lucide-react";
import { Button, Loading } from "../components/ui";
import { Tip } from "../components/ui/tip";
import { InboxList, rowKey } from "../components/inbox/InboxList";
import { ChatTab } from "./project/ChatTab";
import { useInbox } from "../hooks/useInbox";
import type { InboxRow } from "../lib/api/inbox";
import type { ChatKey } from "../components/chat/ChatList";
import { t } from "../i18n";

/**
 * The agent inbox — every agent as a conversation, most recent first.
 *
 * A SECOND AXIS over the same data, not a replacement for project navigation:
 * this is the conversational way in, the project rail is the structural one.
 *
 * Two panes, like any messaging app: pick on the left, read and reply on the
 * right. The list used to fill the width and NAVIGATE AWAY on click, so
 * reading one conversation meant losing the list — which defeats the point of
 * having an inbox at all. The right pane embeds the real chat surface rather
 * than a read-only rendering of it: if you can see what an agent said, you can
 * answer it there and then.
 */
export function InboxScreen() {
  const navigate = useNavigate();
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const { rows, isLoading } = useInbox(includeEmpty);
  const [selected, setSelected] = useState<InboxRow | null>(null);

  // Open the most recent conversation on arrival. An inbox that lands on an
  // empty pane makes you click twice to see the thing you came for.
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0]);
  }, [rows, selected]);

  if (isLoading) return <Loading />;

  const pid = selected ? String(selected.project_id ?? 0) : null;
  const title = selected ? (selected.agent_name || selected.agent_slug) : "";

  /**
   * Which conversation the chat pane should open.
   *
   * The super-agent has no per-agent conversation files — it talks on channels,
   * and its history is the cross-channel ledger — so its row addresses a
   * THREAD (channel + date). A project agent addresses a conversation. With
   * neither, fall through to a live session rather than showing nothing.
   */
  const selectionFor = (row: InboxRow): ChatKey | undefined => {
    if (row.kind === "super_agent") {
      return row.channel && row.conversation_id
        ? { kind: "thread", channel: row.channel, threadId: row.conversation_id }
        : undefined;
    }
    return row.conversation_id
      ? { kind: "conv", agentSlug: row.agent_slug, convId: row.conversation_id }
      : { kind: "live", agentSlug: row.agent_slug };
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="inbox-screen">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("inbox.title")}</h1>
          <p className="text-xs text-muted-fg">{t("inbox.subtitle")}</p>
        </div>
        <Tip content={includeEmpty ? t("inbox.hide_quiet") : t("inbox.show_quiet")}>
          <Button size="sm" variant={includeEmpty ? "primary" : "ghost"} onClick={() => setIncludeEmpty((v) => !v)}>
            {includeEmpty ? <EyeOff size={14} /> : <Eye size={14} />}
            <span className="hidden sm:inline">{t("inbox.show_quiet")}</span>
          </Button>
        </Tip>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card/40">
        <InboxList
          rows={rows}
          selectedKey={selected ? rowKey(selected) : null}
          onSelect={setSelected}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-8">
              <p className="text-sm text-muted-fg">{t("inbox.empty")}</p>
            </div>
          ) : (
            <>
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{title}</h2>
                  <p className="truncate text-[11px] text-muted-fg">
                    {selected.project_name || t("inbox.super_agent_scope")}
                    {selected.channel ? ` · ${selected.channel}` : ""}
                  </p>
                </div>
                {/* The structural way out. The inbox is a second axis over the
                    same data, so getting from a conversation to its project
                    must always be one click. */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    navigate(
                      selected.kind === "super_agent"
                        ? "/p/0/chat"
                        : `/p/${selected.project_id}/agents/${encodeURIComponent(selected.agent_slug)}`,
                    )}
                >
                  {t("inbox.open_in_project")} <ArrowUpRight size={13} />
                </Button>
              </header>

              <div className="min-h-0 flex-1">
                {/* Remounted per selection: the chat surface holds its own
                    session state, and carrying one agent's stream into another
                    agent's pane would be worse than a moment's reload. */}
                <ChatTab
                  key={rowKey(selected)}
                  pid={pid as string}
                  hideSidebar
                  initialSelection={selectionFor(selected)}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
