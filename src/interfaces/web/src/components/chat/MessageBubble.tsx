import { Bot, Copy, User, Info } from "lucide-react";
import { cn } from "../../lib/cn";
import { ToolCall } from "./ToolCall";
import { textOf, type ChatMsg } from "../../hooks/useChat";

interface Props {
  msg: ChatMsg;
  onCopy?: (text: string) => void;
}

export function MessageBubble({ msg, onCopy }: Props) {
  const mine = msg.role === "user";
  const copyText = textOf(msg);
  const hasTools = msg.parts.some((p) => p.kind === "tool");

  return (
    <div className={cn("group flex items-start gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Bot size={14} />
        </span>
      )}
      <div className={cn("flex min-w-0 flex-col gap-1.5", mine ? "items-end" : "w-full max-w-[85%]")}>
        {/* Operational notes (engine fallbacks, retries, suppressed tools). */}
        {!mine && msg.notes && msg.notes.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {msg.notes.map((n, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] text-amber-400/80">
                <Info size={10} /> {n}
              </span>
            ))}
          </div>
        )}

        {/* Ordered parts: interleaved assistant text + tool calls. */}
        {msg.parts.map((part, i) =>
          part.kind === "tool" ? (
            <ToolCall key={`${part.id}-${i}`} part={part} />
          ) : part.text ? (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
                mine
                  ? "rounded-br-sm bg-primary text-primary-fg"
                  : "w-full rounded-bl-sm border border-border bg-card text-foreground",
              )}
            >
              {part.text}
            </div>
          ) : null,
        )}

        {/* Pending placeholder before any part has arrived. */}
        {!mine && msg.pending && msg.parts.length === 0 && (
          <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            …
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTs(msg.ts)}</span>
          {!mine && msg.model && <span className="font-mono">· {msg.model}</span>}
          {!mine && hasTools && (
            <span>· {msg.parts.filter((p) => p.kind === "tool").length} tools</span>
          )}
          {onCopy && copyText && (
            <button
              type="button"
              onClick={() => onCopy(copyText)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title="Copiar"
            >
              <Copy size={10} /> copiar
            </button>
          )}
        </div>
      </div>
      {mine && (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
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
  } catch {
    return iso;
  }
}
