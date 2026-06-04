import { Plus, MessageSquare, Trash2, Pencil } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { Empty } from "../ui";
import type { CodeSessionRow } from "../../lib/api/code";

interface Props {
  sessions: CodeSessionRow[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
}

// Left-rail list of a project's code sessions (OpenCode's session switcher).
export function CodeSessionList({
  sessions,
  activeId,
  busy,
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
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          title={t("code_module.new_session")}
          data-testid="code-new-session"
          className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Plus className="size-3" /> {t("code_module.new_session")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="p-2">
            <Empty>{t("code_module.no_sessions")}</Empty>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id} className="group/item relative">
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
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
                      {s.mode} · {s.messageCount} msg{s.model ? ` · ${s.model}` : ""}
                    </span>
                  </span>
                </button>
                <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover/item:flex">
                  <button
                    type="button"
                    onClick={() => onRename(s.id, s.title)}
                    title={t("code_module.rename")}
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(s.id)}
                    title={t("code_module.delete")}
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-rose-500"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
