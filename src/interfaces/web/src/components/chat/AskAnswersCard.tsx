import { MessageCircleQuestion } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

interface QA {
  question: string;
  answer: string;
  skipped: boolean;
}

// Parse the compiled answer text emitted by InlineAskPanel.compileAnswers.
// Returns null when the text doesn't match the expected pattern (so callers
// can fall back to the standard user bubble).
export function parseAskAnswerText(text: string): QA[] | null {
  const lines = text.split("\n");
  const pairs: QA[] = [];
  let current: QA | null = null;
  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (current) pairs.push(current);
      current = { question: line.slice(2), answer: "", skipped: false };
    } else if (line.startsWith("  → ") && current) {
      const a = line.slice(4);
      current.answer = a;
      current.skipped = a === "(omitido)";
    } else {
      return null;
    }
  }
  if (current) pairs.push(current);
  return pairs.length > 0 ? pairs : null;
}

interface Props {
  text: string;
}

// Full-width centered card rendered between the assistant turn that asked the
// questions and the next assistant turn. Replaces the right-aligned user bubble
// so the Q&A reads as a single coherent block instead of an opaque user reply.
export function AskAnswersCard({ text }: Props) {
  const pairs = parseAskAnswerText(text);
  if (!pairs) return null;
  return (
    <div className="flex w-full justify-center">
      <div
        className="w-full max-w-[85%] rounded-2xl border border-border/70 bg-card/40 px-4 py-3 shadow-sm"
        data-testid="ask-answers-card"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <MessageCircleQuestion className="size-3.5" />
          <span>{t("ask_panel.answers_header")}</span>
        </div>
        <ul className="space-y-2.5">
          {pairs.map((p, i) => (
            <li key={i} className="space-y-0.5">
              <div className="text-sm font-medium leading-snug text-foreground">
                {p.question}
              </div>
              <div
                className={cn(
                  "whitespace-pre-wrap text-[13px] leading-snug",
                  p.skipped
                    ? "italic text-muted-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {p.answer}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
