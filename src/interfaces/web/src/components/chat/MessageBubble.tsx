import { Bot, Copy, User } from "lucide-react";
import { cn } from "../../lib/cn";
import type { ChatMsg } from "../../hooks/useChat";

interface Props {
  msg: ChatMsg;
  onCopy?: (text: string) => void;
}

export function MessageBubble({ msg, onCopy }: Props) {
  const mine = msg.role === "user";
  return (
    <div className={cn("group flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-fg">
          <Bot size={14} />
        </span>
      )}
      <div className={cn("flex max-w-[80%] flex-col gap-1", mine && "items-end")}>
        <div className={cn(
          "whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
          mine
            ? "rounded-br-sm bg-primary text-primary-fg"
            : "rounded-bl-sm border border-border bg-card text-foreground",
          msg.pending && "opacity-80",
        )}>
          {msg.content || (msg.pending ? "…" : "")}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-fg opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTs(msg.ts)}</span>
          {onCopy && msg.content && (
            <button
              type="button"
              onClick={() => onCopy(msg.content)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title="Copiar"
            >
              <Copy size={10} /> copiar
            </button>
          )}
        </div>
      </div>
      {mine && (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-fg">
          <User size={14} />
        </span>
      )}
    </div>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}
