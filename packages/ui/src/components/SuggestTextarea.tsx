import { type CSSProperties, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";
import { Textarea, type TextareaProps } from "./Textarea";

/** The list's height at most (its CSS max-height): below the field when it fits there, above otherwise. */
const LIST_MAX = 220;

export interface Suggestion {
  /** What is written in place of the word being typed ("$APX_LLM_OUTPUT", "{{pre_output}}"). */
  insert: string;
  /** What it holds, shown beside it. */
  hint?: string;
}

export interface SuggestTextareaProps extends Omit<TextareaProps, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly Suggestion[];
  /** Characters that open the list when a word starts with them. */
  triggers?: readonly string[];
}

/** The word right before the caret, and where it starts. */
function wordAt(text: string, caret: number): { start: number; word: string } {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start--;
  return { start, word: text.slice(start, caret) };
}

/**
 * A textarea that offers what can be written where the word being typed starts with a trigger ("$" or "{"):
 * variables in a command or a prompt. Arrows choose, Enter or Tab writes it, Escape closes the list.
 */
export function SuggestTextarea({
  value,
  onValueChange,
  suggestions,
  triggers = ["$", "{"],
  className,
  onKeyDown,
  ...rest
}: SuggestTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { portalRef } = useApx();
  const [place, setPlace] = useState<CSSProperties>();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const { start, word } = wordAt(value, caret);
  const open = !closed && word.length > 0 && triggers.some((c) => word.startsWith(c));
  const matches = open
    ? suggestions.filter((s) => s.insert.toLowerCase().startsWith(word.toLowerCase()) && s.insert !== word)
    : [];
  const pick = (s: Suggestion) => {
    const next = value.slice(0, start) + s.insert + value.slice(caret);
    const at = start + s.insert.length;
    onValueChange(next);
    setCaret(at);
    requestAnimationFrame(() => ref.current?.setSelectionRange(at, at));
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = matches[Math.min(active, matches.length - 1)];
        if (s) pick(s);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setClosed(true);
        return;
      }
    }
    onKeyDown?.(e);
  };
  const shown = matches.length > 0;
  // The list floats over everything (a dialog's scroll area would clip it): fixed, under or above the field.
  useLayoutEffect(() => {
    if (!shown) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < LIST_MAX + 8 && r.top > below;
      setPlace({
        position: "fixed",
        left: r.left + 8,
        width: Math.max(r.width - 16, 160),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [shown]);
  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? 0);
    setClosed(false);
    setActive(0);
  };
  return (
    <div className={cx("apx-suggest", className)}>
      <Textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          onValueChange(e.currentTarget.value);
          track(e.currentTarget);
        }}
        onKeyDown={keys}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key))
            setCaret(e.currentTarget.selectionStart);
        }}
        onClick={(e) => track(e.currentTarget)}
        onBlur={() => setClosed(true)}
      />
      {shown &&
        place &&
        createPortal(
          <ul className="apx-suggest__list" style={place}>
            {matches.map((s, i) => (
              <li key={s.insert}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-current={i === active || undefined}
                  className={cx("apx-suggest__item", i === active && "is-active")}
                  // Chosen before the textarea loses focus.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                >
                  <code>{s.insert}</code>
                  {s.hint && <span>{s.hint}</span>}
                </button>
              </li>
            ))}
          </ul>,
          portalRef.current ?? document.body,
        )}
    </div>
  );
}
