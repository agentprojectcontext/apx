import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { AgentAvatar, SUPER_AGENT_ICON } from "../../components/agents/AgentAvatar";
import { useInbox } from "../../hooks/useInbox";
import { pidOf } from "./routes";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { InboxRow } from "../../lib/api/inbox";

/**
 * "New" on the phone: pick any agent and start talking, whether or not you have
 * a chat with it yet.
 *
 * The list on the screen behind this is web-only and hides agents you have not
 * talked to — that is what keeps it tidy. This sheet is the way back to all of
 * them: it asks for the FULL roster (`include_empty`, every channel) so an agent
 * that has only ever run on Telegram, or one you have never opened, is still
 * one tap away. Opening one lands on a fresh web session — the chat route with
 * no `:session` segment resolves to `live` when there is nothing stored yet.
 *
 * a2a threads are conversations between two agents, not someone you start a new
 * chat with, so they are left out here.
 */
export function NewChatSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (row: InboxRow) => void;
}) {
  const { rows, isLoading } = useInbox(true, null);
  const [query, setQuery] = useState("");

  const agents = useMemo(
    () => rows.filter((r) => r.kind === "agent" || r.kind === "super_agent"),
    [rows],
  );

  const q = query.trim().toLowerCase();
  const shown = q
    ? agents.filter((r) =>
        [r.agent_name, r.agent_slug, r.project_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : agents;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="gap-3 border-b border-border px-4 pb-3 pt-4">
          <SheetTitle>{t("mobile.new_chat_title")}</SheetTitle>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("inbox.search")}
              className="h-10 w-full rounded-full border border-border bg-muted/30 pl-9 pr-3 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
            />
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {isLoading && (
            <p className="px-4 py-8 text-center text-sm text-muted-fg">{t("common.loading")}</p>
          )}
          {!isLoading && !shown.length && (
            <p className="px-4 py-8 text-center text-sm text-muted-fg">{t("mobile.new_chat_empty")}</p>
          )}
          {shown.map((row) => (
            <AgentPick key={`${row.project_id}:${row.agent_slug}`} row={row} onPick={onPick} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AgentPick({ row, onPick }: { row: InboxRow; onPick: (row: InboxRow) => void }) {
  const isSuper = row.kind === "super_agent";
  const name = row.agent_name || row.agent_slug;
  return (
    <button
      type="button"
      data-testid={`new-chat-${row.agent_slug}`}
      onClick={() => onPick(row)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/60"
    >
      <AgentAvatar
        icon={isSuper ? row.agent_icon || SUPER_AGENT_ICON : row.agent_icon}
        emoji={row.agent_emoji}
        name={name}
        size={40}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{name}</span>
        <span className={cn("block truncate text-[12px] text-muted-fg")}>
          {isSuper ? t("agents_ui.super_agent_badge") : row.project_name || row.agent_slug}
        </span>
      </span>
    </button>
  );
}
