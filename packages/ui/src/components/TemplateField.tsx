import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import { Icons } from "../icons";
import { useApx } from "./ApxProvider";
import { Textarea, type TextareaProps } from "./Textarea";

/** The list's height at most (its CSS max-height): below the field when it fits there, above otherwise. */
const LIST_MAX = 280;

export interface TemplateValue {
  /** What is written into the text ("$steps.ask.text", "secret://acme_key"). */
  insert: string;
  /** What it is, in the person's words ("Answer of Ask"). */
  label: string;
  /** Shown after the label, quieter. */
  hint?: string;
  /** A secret: its badge and row read as one. */
  secret?: boolean;
}

export interface TemplateGroup {
  label: string;
  values: readonly TemplateValue[];
  /**
   * Something to do from this group ("Save a secret"), last in it: shown when the whole list is open, or when what is
   * being typed starts with `when`. A group with an action shows even with no values.
   */
  action?: { label: string; onSelect: () => void; when?: string };
}

export interface TemplateFieldProps extends Omit<TextareaProps, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  /** What can be inserted, in groups; empty groups are not shown. */
  groups: readonly TemplateGroup[];
  /** What in the text shows as a badge (global regex). */
  pattern: RegExp;
  /** Which badges are secrets (tested on each badge's text). */
  secretPattern?: RegExp;
  /** Words that open the list as they are typed. */
  triggers?: readonly string[];
  /** Accessible name of the button that opens the whole list. */
  pickLabel: string;
  /** Said in the list when nothing matches. */
  emptyText?: string;
  /** One line: Enter never breaks it, pasted line breaks become spaces (a key, an address). */
  singleLine?: boolean;
}

type Flat = TemplateValue & { group: string; run?: () => void; when?: string };

/**
 * What is being typed before the caret: from the last trigger in the current word ("KEY=$st" → "$st"), so a value can
 * follow `=` or `:` with no space; empty when the word has no trigger.
 */
function typedAt(text: string, caret: number, triggers: readonly string[]): { start: number; word: string } {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start--;
  const word = text.slice(start, caret);
  const at = Math.max(...triggers.map((c) => word.lastIndexOf(c)));
  return at < 0 ? { start: caret, word: "" } : { start: start + at, word: word.slice(at) };
}

/** The values a typed word asks for: `{{name` by name or text, anything else by how the text starts. */
function matching(all: readonly Flat[], word: string): Flat[] {
  const q = (word.startsWith("{{") ? word.slice(2) : word).toLowerCase();
  const acts = all.filter((v) => v.run && v.when && word.toLowerCase().startsWith(v.when));
  const values = all.filter((v) => !v.run);
  if (word.startsWith("{{"))
    return [...values.filter((v) => v.insert.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)), ...acts];
  return [
    ...values.filter(
      (v) => v.insert.toLowerCase().startsWith(q) || (q.length > 1 && v.label.toLowerCase().includes(q.slice(1))),
    ),
    ...acts,
  ];
}

/** The text with its placeholders drawn as badges, in the same metrics as the textarea above it. */
function mirror(text: string, pattern: RegExp, secret: RegExp | undefined): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(
    new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
  )) {
    if (!m[0]) continue;
    out.push(text.slice(last, m.index));
    out.push(
      <mark key={m.index} className={cx("apx-tfield__chip", secret?.test(m[0]) && "is-secret")}>
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  // A last newline needs something after it to take its line.
  out.push(`${text.slice(last)}​`);
  return out;
}

/**
 * A text field where values are inserted without knowing their syntax: typing a trigger (`{{`, `$`, `secret://`) or
 * pressing the button opens them, grouped; what was inserted reads as a badge. Arrows choose, Enter or Tab writes it,
 * Escape closes the list.
 */
export function TemplateField({
  value,
  onValueChange,
  groups,
  pattern,
  secretPattern,
  triggers = ["{{", "$", "secret://"],
  pickLabel,
  emptyText,
  singleLine = false,
  className,
  onKeyDown,
  rows = 2,
  ...rest
}: TemplateFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const pending = useRef<number | undefined>(undefined);
  const listId = useId();
  const { portalRef } = useApx();
  const [place, setPlace] = useState<CSSProperties>();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(true);
  /** Opened by the button: every value, inserted at the caret. */
  const [browsing, setBrowsing] = useState(false);
  const all = useMemo<Flat[]>(
    () =>
      groups.flatMap((g) => [
        ...g.values.map((v) => ({ ...v, group: g.label })),
        ...(g.action
          ? [{ insert: "", label: g.action.label, group: g.label, run: g.action.onSelect, when: g.action.when }]
          : []),
      ]),
    [groups],
  );
  const { start, word } = typedAt(value, caret, triggers);
  const typed = !closed && word.length > 0;
  const matches = browsing ? all : typed ? matching(all, word).filter((v) => v.run || v.insert !== word) : [];
  // A typed word that matches nothing ("$5") opens nothing; the button always shows what there is.
  const open = browsing || matches.length > 0;
  const close = () => {
    setBrowsing(false);
    setClosed(true);
  };
  const pick = (v: Flat) => {
    if (v.run) {
      close();
      v.run();
      return;
    }
    const from = browsing ? caret : start;
    const next = value.slice(0, from) + v.insert + value.slice(caret);
    const at = from + v.insert.length;
    pending.current = at;
    onValueChange(next);
    setCaret(at);
    setBrowsing(false);
    setClosed(true);
  };
  // The caret goes after what was inserted as soon as the new text is in the field, before any next key.
  useLayoutEffect(() => {
    const at = pending.current;
    if (at === undefined || !ref.current || ref.current.value !== value) return;
    pending.current = undefined;
    ref.current.focus();
    ref.current.setSelectionRange(at, at);
  }, [value]);
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const v = matches[Math.min(active, matches.length - 1)];
        if (v) pick(v);
        return;
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (singleLine && e.key === "Enter") e.preventDefault();
    onKeyDown?.(e);
  };
  // The list floats over everything (a side panel's scroll would clip it): fixed, under or above the field.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < LIST_MAX + 8 && r.top > below;
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
      setPlace({
        position: "fixed",
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
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
  }, [open]);
  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? 0);
    setClosed(false);
    setBrowsing(false);
    setActive(0);
  };
  let index = -1;
  const shownGroups = groups
    .map((g) => ({ label: g.label, values: matches.filter((m) => m.group === g.label) }))
    .filter((g) => g.values.length);
  return (
    <div className={cx("apx-tfield", singleLine && "is-single", className)}>
      <div ref={back} className="apx-tfield__mirror apx-textarea" aria-hidden="true">
        {mirror(value, pattern, secretPattern)}
      </div>
      <Textarea
        {...rest}
        rows={singleLine ? 1 : rows}
        ref={ref}
        value={value}
        className="apx-tfield__input"
        aria-controls={open ? listId : undefined}
        onChange={(e) => {
          const text = e.currentTarget.value;
          onValueChange(singleLine ? text.replace(/[\r\n]+/g, " ") : text);
          track(e.currentTarget);
        }}
        onKeyDown={keys}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key))
            setCaret(e.currentTarget.selectionStart);
        }}
        onClick={(e) => track(e.currentTarget)}
        onScroll={(e) => {
          if (back.current) back.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onBlur={close}
      />
      <button
        type="button"
        className="apx-tfield__pick"
        aria-label={pickLabel}
        title={pickLabel}
        // Opened before the textarea loses focus, at the caret it had.
        onMouseDown={(e) => {
          e.preventDefault();
          if (browsing) return close();
          setCaret(ref.current?.selectionStart ?? value.length);
          setActive(0);
          setBrowsing(true);
          ref.current?.focus();
        }}
      >
        <Icons.Braces size={13} />
      </button>
      {open &&
        place &&
        createPortal(
          <div id={listId} role="listbox" aria-label={pickLabel} className="apx-tfield__list" style={place}>
            {shownGroups.length === 0 && emptyText && <div className="apx-tfield__empty">{emptyText}</div>}
            {shownGroups.map((g) => (
              <fieldset key={g.label} className="apx-tfield__set">
                <legend className="apx-tfield__group">{g.label}</legend>
                {g.values.map((v) => {
                  index++;
                  const i = index;
                  return (
                    <button
                      key={`${g.label}:${v.run ? "+" : v.insert}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === active}
                      className={cx("apx-tfield__item", i === active && "is-active", v.run && "is-action")}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(v);
                      }}
                    >
                      {v.run ? <Icons.Plus size={12} /> : v.secret ? <Icons.KeyRound size={12} /> : null}
                      <span className="apx-tfield__label">{v.label}</span>
                      {v.hint && <span className="apx-tfield__hint">{v.hint}</span>}
                      {!v.run && <code className={cx("apx-tfield__chip", v.secret && "is-secret")}>{v.insert}</code>}
                    </button>
                  );
                })}
              </fieldset>
            ))}
          </div>,
          portalRef.current ?? document.body,
        )}
    </div>
  );
}
