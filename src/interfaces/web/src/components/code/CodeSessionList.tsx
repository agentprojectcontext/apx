import { Plus, MessageSquare, Trash2, Pencil, Bot } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { Empty } from "../ui";
import { Tip } from "../ui/tip";
import type { CodeSessionRow } from "../../lib/api/code";

interface Props {
  sessions: CodeSessionRow[];
  activeId: string | null;
  busy: boolean;
  /** Name each row's project — true while the list spans more than one. */
  showProject?: boolean;
  /** Empty-state copy differs between "no sessions at all" and "none here". */
  filtered?: boolean;
  onSelect: (row: CodeSessionRow) => void;
  onCreate: () => void;
  onRename: (row: CodeSessionRow, current: string) => void;
  onDelete: (row: CodeSessionRow) => void;
}

// Left-rail list of code sessions (OpenCode's session switcher).
//
// The rows carry their project and their agent on purpose: a session created
// from `apx exec --code` in some other checkout lands in THAT project, and
// without those two facts on the row the list is a wall of "New session" you
// cannot tell apart.
export function CodeSessionList({
  sessions,
  activeId,
  busy,
  showProject = false,
  filtered = false,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  return (
    <div className="flex h-full flex-col" data-testid="code-session-list">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("code_module.sessions")}
        </span>
        <Tip content={t("code_module.new_session")}>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            data-testid="code-new-session"
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Plus className="size-3" /> {t("code_module.new_session")}
          </button>
        </Tip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="p-2">
            <Empty>
              {t(filtered ? "code_module.no_sessions_here" : "code_module.no_sessions")}
            </Empty>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={`${s.pid ?? ""}:${s.id}`} className="group/item relative">
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  data-testid="code-session-row"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    s.id === activeId
                      ? "bg-accent text-accent-fg"
                      : "text-foreground/80 hover:bg-accent/50",
                  )}
                >
                  <MessageSquare className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {showProject && s.projectName ? `${s.projectName} · ` : ""}
                      {s.mode} · {t("code_module.msg_count", { n: s.messageCount })}
                    </span>
                    {s.agentSlug && (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Bot className="size-2.5 shrink-0 opacity-70" />
                        <span className="truncate font-mono">{s.agentSlug}</span>
                      </span>
                    )}
                  </span>
                </button>
                <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover/item:flex">
                  <Tip content={t("code_module.rename")}>
                    <button
                      type="button"
                      onClick={() => onRename(s, s.title)}
                      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <Pencil className="size-3" />
                    </button>
                  </Tip>
                  <Tip content={t("code_module.delete")}>
                    <button
                      type="button"
                      onClick={() => onDelete(s)}
                      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-rose-500"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </Tip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
