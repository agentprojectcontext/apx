import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Plus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";

// VarTokenInput
// -------------
// Single-line editor that renders `${var.NAME}` references as inline badges.
// The wrapper mirrors the shadcn <Input> visual (bg-transparent, border-input,
// focus-visible ring) so a row of regular Inputs and a row of VarTokenInputs
// look identical to the user. The badge text shows only the var NAME — the
// `${var…}` wrapper is implementation detail.

interface Token {
  type: "text" | "var";
  value: string;
}

const VAR_PATTERN = "\\$\\{var\\.([^}\\s]+)\\}";

function makeVarRe(flags = "g"): RegExp {
  return new RegExp(VAR_PATTERN, flags);
}

function hasVarRef(s: string): boolean {
  return makeVarRe("").test(s);
}

export function parseTokens(value: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of value.matchAll(makeVarRe("g"))) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push({ type: "var", value: m[1] });
    last = start + m[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function serializeDom(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      const name = node.dataset.varName;
      if (name) out += `\${var.${name}}`;
      else if (node.tagName === "BR") out += "";
      else out += node.textContent ?? "";
    }
  }
  // Strip zero-width chars (caret spacers + paste artifacts) and convert
  // non-breaking spaces (U+00A0) back to regular spaces. Both are normal
  // contentEditable side-effects but they poison header values — Asana, for
  // one, rejects `Bearer\xA0token` because it expects a literal ASCII space.
  return out
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");
}

function renderDom(root: HTMLElement, value: string) {
  root.replaceChildren();
  const tokens = parseTokens(value);
  for (const tok of tokens) {
    if (tok.type === "text") {
      root.appendChild(document.createTextNode(tok.value));
    } else {
      root.appendChild(buildBadge(tok.value));
    }
  }
  if (tokens.length === 0 || tokens[tokens.length - 1].type === "var") {
    root.appendChild(document.createTextNode(""));
  }
}

function buildBadge(name: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.varName = name;
  // Subtle inline-tag look: no chip-style border, just a tinted background and
  // a leading "$" marker so the var ref reads as part of the line, not as a
  // floating element on top of the input.
  span.className =
    "inline-flex items-baseline px-1 rounded bg-primary/10 text-primary font-mono text-[12px] select-none cursor-default whitespace-nowrap";
  span.textContent = `$${name}`;
  span.title = `\${var.${name}}`;
  return span;
}

function insertAtRange(range: Range, fragment: Node) {
  range.deleteContents();
  range.insertNode(fragment);
  range.setStartAfter(fragment);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function placeCaretAtEnd(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export interface VarTokenInputHandle {
  insertVar: (name: string) => void;
  focus: () => void;
}

interface VarTokenInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  varNames?: string[];
  onCreateVar?: () => void;
}

export const VarTokenInput = forwardRef<VarTokenInputHandle, VarTokenInputProps>(
  function VarTokenInput({ value, onChange, placeholder, className, varNames = [], onCreateVar }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const lastSerialized = useRef(value);

    // Sync DOM <- props.value only when external value diverges. Typing inside
    // the editor never round-trips through React, which keeps the caret put.
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      if (value === lastSerialized.current && el.childNodes.length > 0) return;
      renderDom(el, value);
      lastSerialized.current = value;
    }, [value]);

    const emit = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;
      const s = serializeDom(el);
      lastSerialized.current = s;
      if (s !== value) onChange(s);
    }, [onChange, value]);

    const handleInput = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;
      const current = serializeDom(el);
      if (hasVarRef(current) && hasUnbadgedRef(el)) {
        const caretChar = caretCharOffset(el);
        renderDom(el, current);
        if (caretChar != null) restoreCaret(el, caretChar);
      }
      lastSerialized.current = serializeDom(el);
      if (lastSerialized.current !== value) onChange(lastSerialized.current);
    }, [onChange, value]);

    const saveSelection = useCallback(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const el = editorRef.current;
      if (el && el.contains(range.startContainer)) {
        savedRange.current = range.cloneRange();
      }
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter") {
          // Single-line editor: never insert a newline.
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
          return;
        }
        if (e.key === "Backspace") {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          if (!range.collapsed) return;
          const { startContainer, startOffset } = range;
          if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
            const prev = startContainer.previousSibling;
            if (prev instanceof HTMLElement && prev.dataset.varName) {
              e.preventDefault();
              prev.remove();
              emit();
              return;
            }
          } else if (startContainer === editorRef.current) {
            const prev = startContainer.childNodes[startOffset - 1];
            if (prev instanceof HTMLElement && prev.dataset.varName) {
              e.preventDefault();
              prev.remove();
              emit();
              return;
            }
          }
        }
      },
      [emit],
    );

    const insertVar = useCallback(
      (name: string) => {
        const el = editorRef.current;
        if (!el) return;
        const restored = savedRange.current;
        el.focus();
        let range: Range;
        if (restored && el.contains(restored.startContainer)) {
          range = restored;
        } else {
          range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
        }
        insertAtRange(range, buildBadge(name));
        savedRange.current = null;
        emit();
      },
      [emit],
    );

    useImperativeHandle(
      ref,
      () => ({
        insertVar,
        focus: () => editorRef.current?.focus(),
      }),
      [insertVar],
    );

    const filtered = varNames.filter((n) =>
      n.toLowerCase().includes(pickerQuery.toLowerCase()),
    );

    // Editor classes mirror shadcn <Input> so a row of VarTokenInputs sits
    // next to plain Inputs without visual drift.
    return (
      <div
        className={cn(
          "group flex items-stretch w-full min-w-0 rounded-lg border border-input bg-transparent dark:bg-input/30 transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          className,
        )}
      >
        <div className="relative flex-1 min-w-0">
          <div
            ref={editorRef}
            role="textbox"
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onBlur={emit}
            onFocus={saveSelection}
            onMouseUp={saveSelection}
            onKeyUp={saveSelection}
            className={cn(
              "h-8 w-full whitespace-nowrap overflow-x-auto px-2.5 py-1 text-sm rounded-l-lg",
              "focus:outline-none font-mono leading-7",
              "[&_*]:align-baseline",
            )}
            data-placeholder={placeholder || ""}
            style={{ caretColor: "currentColor" }}
          />
          {value === "" && placeholder && (
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 select-none text-sm text-muted-foreground font-mono">
              {placeholder}
            </span>
          )}
        </div>
        <div className="relative flex">
          <Tip content={t("chat_ui.insert_variable")}>
            <button
              type="button"
              // onMouseDown prevents the editor from blurring before we capture
              // the saved range — that's what kept the caret jumping to start.
              onMouseDown={(e) => {
                e.preventDefault();
                saveSelection();
              }}
              onClick={() => setPickerOpen((v) => !v)}
              aria-label={t("chat_ui.insert_variable")}
              className={cn(
                "flex items-center justify-center px-2 min-w-8 border-l border-input text-muted-foreground rounded-r-lg",
                "hover:bg-muted/60 hover:text-foreground transition-colors",
                pickerOpen && "bg-muted/60 text-foreground",
              )}
            >
              <Plus size={14} />
            </button>
          </Tip>
          {pickerOpen && (
            <VarPickerPopover
              query={pickerQuery}
              onQuery={setPickerQuery}
              varNames={filtered}
              onPick={(n) => {
                insertVar(n);
                setPickerOpen(false);
                setPickerQuery("");
              }}
              onClose={() => {
                setPickerOpen(false);
                setPickerQuery("");
              }}
              onCreateVar={onCreateVar}
            />
          )}
        </div>
      </div>
    );
  },
);

function VarPickerPopover({
  query,
  onQuery,
  varNames,
  onPick,
  onClose,
  onCreateVar,
}: {
  query: string;
  onQuery: (s: string) => void;
  varNames: string[];
  onPick: (n: string) => void;
  onClose: () => void;
  onCreateVar?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus the search field once on open, then never again — re-focus on every
  // render is what made the editor click "bounce" back to the picker.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-lg"
    >
      <div className="border-b border-border p-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("shared_ui.search_variable_ph")}
          className="w-full rounded bg-muted/40 px-2 py-1 text-xs font-mono outline-none"
        />
      </div>
      <ul className="max-h-44 overflow-auto p-1 text-xs">
        {varNames.length === 0 && (
          <li className="px-2 py-1.5 text-muted-foreground">{t("shared_ui.no_matches")}</li>
        )}
        {varNames.map((n) => (
          <li key={n}>
            <button
              type="button"
              // Prevent the editor blur that would happen before onClick fires.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(n)}
              className="block w-full rounded px-2 py-1.5 text-left font-mono hover:bg-muted/60"
            >
              {n}
            </button>
          </li>
        ))}
      </ul>
      {onCreateVar && (
        <div className="border-t border-border p-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onCreateVar();
              onClose();
            }}
            className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
          >
            <Plus size={12} /> {t("shared_ui.create_variable")}
          </button>
        </div>
      )}
    </div>
  );
}

function hasUnbadgedRef(root: HTMLElement): boolean {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (hasVarRef(node.textContent ?? "")) return true;
    }
  }
  return false;
}

function caretCharOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

function restoreCaret(root: HTMLElement, charOffset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = charOffset;
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = (node.textContent ?? "").length;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  placeCaretAtEnd(root);
}
