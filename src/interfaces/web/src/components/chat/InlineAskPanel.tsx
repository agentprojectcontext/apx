import { useEffect, useMemo, useState } from "react";
import { X, CornerDownLeft } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

// Normalized shape we get from the ask_questions tool (see ask-questions.js).
export interface AskOption {
  label: string;
  description?: string;
}
export interface AskQuestion {
  question: string;
  header?: string;
  options?: AskOption[];
  multiSelect?: boolean;
  allowText?: boolean;
}

interface Props {
  /** Stable key for this question batch (the assistant turn id). When it
   *  changes, the panel resets its internal selection state. */
  turnKey: string;
  questions: AskQuestion[];
  /** Called with the final user-message string compiled from all answers. */
  onSubmit: (compiled: string) => void;
  /** Called when the user clicks the X to dismiss without answering. */
  onDismiss?: () => void;
  /** Hide the panel while the next turn is in flight. */
  disabled?: boolean;
}

// One answer slot per question: which option indices are selected + free text.
interface AnswerState {
  picked: Set<number>;
  text: string;
  skipped: boolean;
}

function emptyAnswer(): AnswerState {
  return { picked: new Set<number>(), text: "", skipped: false };
}

function compileAnswers(questions: AskQuestion[], answers: AnswerState[]): string {
  const lines: string[] = [];
  questions.forEach((q, i) => {
    const a = answers[i] || emptyAnswer();
    if (a.skipped) {
      lines.push(`- ${q.question}\n  → (omitido)`);
      return;
    }
    const parts: string[] = [];
    if (q.options && q.options.length > 0) {
      const labels = [...a.picked]
        .sort((x, y) => x - y)
        .map((idx) => q.options![idx]?.label)
        .filter(Boolean) as string[];
      if (labels.length > 0) parts.push(labels.join(", "));
    }
    const text = a.text.trim();
    if (text) {
      parts.push(q.options && q.options.length > 0 ? `(Otro: ${text})` : text);
    }
    const answerText = parts.length > 0 ? parts.join(" ") : "(sin respuesta)";
    lines.push(`- ${q.question}\n  → ${answerText}`);
  });
  return lines.join("\n");
}

// Inline panel rendered above the composer when the last assistant turn ended
// on an unanswered ask_questions call. Clones the Claude Code question UX:
// one question at a time, N/M progress, options + "Otro" free-text, skip / back
// / next controls. Submitting compiles every answer into a single user message
// so the agent sees them in the next turn.
export function InlineAskPanel({ turnKey, questions, onSubmit, onDismiss, disabled }: Props) {
  const total = questions.length;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerState[]>(() =>
    questions.map(() => emptyAnswer()),
  );

  // Reset when a new question batch arrives.
  useEffect(() => {
    setIdx(0);
    setAnswers(questions.map(() => emptyAnswer()));
  }, [turnKey, questions]);

  const current = questions[idx];
  const answer = answers[idx] || emptyAnswer();
  const hasOptions = !!current?.options && current.options.length > 0;
  const multi = !!current?.multiSelect;
  const allowText = current?.allowText !== false; // default true

  const setAnswer = (patch: Partial<AnswerState>) => {
    setAnswers((curr) => {
      const next = [...curr];
      const prev = next[idx] || emptyAnswer();
      next[idx] = { ...prev, ...patch, skipped: false };
      return next;
    });
  };

  const togglePick = (optionIdx: number) => {
    setAnswers((curr) => {
      const next = [...curr];
      const prev = next[idx] || emptyAnswer();
      const picked = new Set(prev.picked);
      if (multi) {
        if (picked.has(optionIdx)) picked.delete(optionIdx);
        else picked.add(optionIdx);
      } else {
        picked.clear();
        picked.add(optionIdx);
      }
      next[idx] = { ...prev, picked, skipped: false };
      return next;
    });
  };

  const canAdvance = useMemo(() => {
    // Always allow advancing — empty answer just records "(sin respuesta)".
    // Skip is explicit via Omitir.
    return true;
  }, []);

  const isLast = idx === total - 1;

  const goPrev = () => setIdx((i) => Math.max(0, i - 1));
  const goNext = () => {
    if (isLast) {
      onSubmit(compileAnswers(questions, answers));
      return;
    }
    setIdx((i) => Math.min(total - 1, i + 1));
  };
  const skipCurrent = () => {
    setAnswers((curr) => {
      const next = [...curr];
      next[idx] = { picked: new Set(), text: "", skipped: true };
      return next;
    });
    if (isLast) {
      // Have to compile from the about-to-be-updated state.
      const nextAnswers = answers.map((a, i) =>
        i === idx ? { picked: new Set<number>(), text: "", skipped: true } : a,
      );
      onSubmit(compileAnswers(questions, nextAnswers));
    } else {
      setIdx((i) => Math.min(total - 1, i + 1));
    }
  };

  // Cmd/Ctrl+Enter → Next/Submit. Number keys 1-9 → pick option (only when the
  // text field doesn't have focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const targetTag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inField = targetTag === "input" || targetTag === "textarea";
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        goNext();
        return;
      }
      if (!inField && hasOptions && /^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10) - 1;
        if (n < (current?.options?.length || 0)) {
          e.preventDefault();
          togglePick(n);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current || total === 0) return null;

  return (
    <div
      className={cn(
        "mx-3 mb-2 rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/80",
        disabled && "pointer-events-none opacity-60",
      )}
      data-testid="inline-ask-panel"
    >
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <span className="mt-0.5 shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono font-medium text-amber-700 dark:text-amber-300">
          {idx + 1}/{total}
        </span>
        {current.header && (
          <span className="mt-0.5 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {current.header}
          </span>
        )}
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {current.question}
        </p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </header>

      <div className="space-y-1 px-2 py-2">
        {hasOptions &&
          current.options!.map((opt, i) => {
            const checked = answer.picked.has(i);
            return (
              <button
                key={`${i}:${opt.label}`}
                type="button"
                onClick={() => togglePick(i)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition",
                  checked
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "hover:border-border hover:bg-accent/40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[11px] text-muted-foreground">
                      {opt.description}
                    </div>
                  )}
                </div>
                {multi ? (
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                      checked
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border bg-background",
                    )}
                  >
                    {checked && <span className="text-[10px] leading-none">✓</span>}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded border font-mono text-[10px]",
                      checked
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                )}
              </button>
            );
          })}

        {(allowText || !hasOptions) && (
          <div className="rounded-md border border-transparent px-2 py-1.5 hover:border-border">
            {hasOptions && (
              <div className="mb-1 text-xs font-medium">
                {t("ask_panel.other")}
              </div>
            )}
            <input
              type="text"
              value={answer.text}
              onChange={(e) => setAnswer({ text: e.target.value })}
              placeholder={
                hasOptions
                  ? t("ask_panel.other_placeholder")
                  : t("ask_panel.text_placeholder")
              }
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-emerald-500"
            />
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={idx === 0}
          className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          {t("ask_panel.back")}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={skipCurrent}
            className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
          >
            {t("ask_panel.skip")}
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canAdvance}
            className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
          >
            {isLast ? t("ask_panel.submit") : t("ask_panel.next")}
            <CornerDownLeft className="size-3 opacity-60" />
          </button>
        </div>
      </footer>
    </div>
  );
}

// Mirror of normalizeQuestion in src/host/daemon/super-agent-tools/tools/ask-questions.js.
// The server already normalizes, but the persisted `result` is stringified
// (see summarizeForTrace in run-agent.js), so we re-normalize locally rather
// than coupling to whichever shape happens to survive serialization.
function normalizeQuestionClient(q: unknown): AskQuestion | null {
  if (typeof q === "string") {
    return { question: q, options: [], multiSelect: false, allowText: true };
  }
  if (!q || typeof q !== "object") return null;
  const obj = q as Record<string, unknown>;
  const text = typeof obj.question === "string" ? obj.question : "";
  if (!text) return null;
  const rawOptions = Array.isArray(obj.options) ? obj.options : [];
  const options: AskOption[] = rawOptions
    .map((o: unknown) => {
      if (typeof o === "string") return { label: o };
      if (o && typeof o === "object" && typeof (o as Record<string, unknown>).label === "string") {
        const oo = o as Record<string, unknown>;
        return {
          label: oo.label as string,
          description: typeof oo.description === "string" ? (oo.description as string) : undefined,
        };
      }
      return null;
    })
    .filter((x): x is AskOption => x !== null);
  return {
    question: text,
    header: typeof obj.header === "string" ? obj.header : undefined,
    options,
    multiSelect: obj.multiSelect === true,
    allowText: obj.allowText === false ? false : true,
  };
}

// Helper: pull questions from the last assistant turn if it ended on an
// unanswered ask_questions call. Returns null when there's nothing to ask.
// Tries args.questions first (raw model output) then result.questions
// (server-normalized, may be JSON-stringified).
export function pendingAskQuestions(msgs: Array<{ role: string; parts: Array<{ kind: string; tool?: string; args?: any; result?: any; status?: string }> }>): {
  turnKey: string;
  questions: AskQuestion[];
} | null {
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  if (last.role !== "assistant") return null;
  // Find the most recent ask_questions tool part in this assistant turn.
  let askPart: typeof last.parts[number] | null = null;
  let askIdx = -1;
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const p = last.parts[i];
    if (p.kind === "tool" && p.tool === "ask_questions") {
      askPart = p;
      askIdx = i;
      break;
    }
  }
  if (!askPart || askIdx < 0) return null;

  // result may be a JSON-stringified blob (persisted shape via
  // summarizeForTrace) or already an object (live stream events).
  let resultObj: Record<string, unknown> | null = null;
  if (typeof askPart.result === "string") {
    try { resultObj = JSON.parse(askPart.result); } catch { resultObj = null; }
  } else if (askPart.result && typeof askPart.result === "object") {
    resultObj = askPart.result as Record<string, unknown>;
  }

  const sources: unknown[] = [];
  if (Array.isArray(askPart.args?.questions)) sources.push(askPart.args!.questions);
  if (resultObj && Array.isArray(resultObj.questions)) sources.push(resultObj.questions);

  let qs: AskQuestion[] = [];
  for (const src of sources) {
    qs = (src as unknown[]).map(normalizeQuestionClient).filter((x): x is AskQuestion => !!x);
    if (qs.length > 0) break;
  }
  if (!qs.length) return null;

  // Stable key: assistant timestamp + tool part index keeps the panel from
  // resetting mid-render while still resetting on a new turn.
  const ts = (last as { ts?: string }).ts || "";
  const turnKey = `${ts}#${askIdx}`;
  return { turnKey, questions: qs };
}
