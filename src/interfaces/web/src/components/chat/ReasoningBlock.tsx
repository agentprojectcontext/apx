import { useState } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

// The model thinking out loud, shown on purpose.
//
// It used to arrive spliced into the answer as `<think>…</think>` and render as
// part of the reply — the reader got the model's notes where the reply should
// be. The adapters now keep the two apart, which left the thinking with nowhere
// to go: correct, and invisible. This is where it goes.
//
// Open while it streams (that is the only moment it is worth watching, and it
// fills the wait before the first word of the answer), collapsed once the
// answer starts — unless the reader says otherwise, whose click wins from then
// on. Never a bubble: this is not something the agent said to you.

interface Props {
  text: string;
  /** Still being written. */
  streaming?: boolean;
}

export function ReasoningBlock({ text, streaming }: Props) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? !!streaming;

  if (!text.trim()) return null;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border/60 bg-muted/10">
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-muted-foreground"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        {streaming ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-violet-600 dark:text-violet-400" />
        ) : (
          <Brain className="size-3.5 shrink-0" />
        )}
        <span className="font-medium">
          {streaming ? t("chat_ui.thinking_running") : t("chat_ui.thinking_label")}
        </span>
      </button>

      {open && (
        <p className="whitespace-pre-wrap border-t border-border/50 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground italic">
          {text}
        </p>
      )}
    </div>
  );
}
