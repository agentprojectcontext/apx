import { Loader2, CheckCircle2, MessageCircleQuestion } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { ToolPart } from "../../hooks/useChat";

interface Props {
  part: ToolPart;
  /** True while the user has not yet answered (panel still showing). */
  pending: boolean;
}

// Extract the question texts (whatever shape — strings or {question}) so we can
// preview them inside the card without depending on the panel's normalizer.
function questionTexts(part: ToolPart): string[] {
  const args = part.args as Record<string, unknown> | undefined;
  const arr = args && Array.isArray(args.questions) ? (args.questions as unknown[]) : [];
  return arr
    .map((q) => {
      if (typeof q === "string") return q;
      if (q && typeof q === "object" && typeof (q as Record<string, unknown>).question === "string") {
        return (q as Record<string, unknown>).question as string;
      }
      return null;
    })
    .filter((s): s is string => !!s);
}

// Special rendering for the ask_questions tool call. Instead of the generic
// collapsed tool widget, show a status bubble:
//   • pending  → spinner + "Esperando respuesta…" + the question list
//   • answered → green check + "Respuestas recibidas" + the same list (muted)
// The actual answer lives in the NEXT user message; we don't duplicate it here.
export function AskQuestionsCard({ part, pending }: Props) {
  const questions = questionTexts(part);
  const label = pending
    ? t("ask_panel.status_waiting")
    : t("ask_panel.status_received");
  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2 text-sm shadow-sm",
        pending
          ? "rounded-bl-sm border-amber-500/30 bg-amber-500/5 text-foreground"
          : "rounded-bl-sm border-emerald-500/30 bg-emerald-500/5 text-foreground",
      )}
      data-testid="ask-questions-card"
      data-state={pending ? "pending" : "answered"}
    >
      <div className="flex items-center gap-2">
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <MessageCircleQuestion className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium">{label}</span>
        {questions.length > 1 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {questions.length} preguntas
          </span>
        )}
      </div>
      {questions.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-5 text-[12px] text-muted-foreground">
          {questions.map((q, i) => (
            <li key={i} className="list-disc">{q}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
