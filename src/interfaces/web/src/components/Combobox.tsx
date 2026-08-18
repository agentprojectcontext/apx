import { useEffect, useLayoutEffect, useRef, useState, type ElementType } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { Tip } from "./ui/tip";
import { t } from "../i18n";
import { toneText } from "../lib/tone";

export interface ComboOption {
  value: string;
  /** Display text. Defaults to `value`. */
  label?: string;
  /** Secondary text, right-aligned in the row (engine id, "off", …). */
  hint?: string;
  icon?: ElementType;
  /** Listed but not pickable — greyed, click does nothing. */
  disabled?: boolean;
}

// Editable combobox: type freely, matching options appear below; click one to
// pick it, or keep your own text. It is a text input that is ALSO a select —
// an id that is not in the list is still a valid value (providers come and go,
// model catalogs lag behind the provider's actual releases).
export function Combobox({
  value,
  onChange,
  onPick,
  options,
  placeholder = t("shared_ui.model_combobox_ph"),
  invalid,
  invalidHint,
  className,
  mono = true,
  emptyHint,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fired only when an option is chosen from the list (not while typing).
   *  Lets a caller prefill siblings on a pick without fighting free text. */
  onPick?: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  invalid?: boolean;
  invalidHint?: string;
  className?: string;
  /** Render the value + option rows in the mono face (model/provider ids). */
  mono?: boolean;
  /** Shown in place of the list when there is nothing to offer. */
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  // Did the user type since the last value that came from outside? Only then
  // do we narrow the list — a field sitting on its committed value should show
  // the whole catalog, not the one row that happens to equal it.
  const [typed, setTyped] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // Last text we emitted, so `value` echoing our own keystroke back does not
  // count as an outside change and reset `typed`.
  const emitted = useRef<string | null>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (emitted.current === value) return;
    setQuery(value);
    setTyped(false);
  }, [value]);

  // Position the portal'd list right under the input, in viewport coords.
  // Recompute on open, scroll, and resize so it tracks the trigger even
  // inside a scrolling modal.
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // Close on outside click — must allow clicks inside the portal'd list too.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q && typed
    ? options.filter((o) => `${o.value} ${o.label || ""}`.toLowerCase().includes(q))
    : options;

  const selected = options.find((o) => o.value === value);
  const SelectedIcon = selected?.icon;

  const pick = (o: ComboOption) => {
    if (o.disabled) return;
    emitted.current = o.value;
    setQuery(o.value);
    setTyped(false);
    setOpen(false);
    (onPick || onChange)(o.value);
  };

  const typeText = (text: string) => {
    emitted.current = text;
    setQuery(text);
    setTyped(true);
    setOpen(true);
    onChange(text);
  };

  const showList = open && menuRect && (filtered.length > 0 || !!emptyHint);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg border bg-background px-2.5 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
          invalid ? "border-amber-500/60" : "border-border",
        )}
      >
        {invalid ? (
          <Tip content={invalidHint || t("models_ui.invalid_hint")}>
            <span>
              <AlertTriangle className={`size-3.5 shrink-0 ${toneText.amber}`} />
            </span>
          </Tip>
        ) : SelectedIcon ? (
          <SelectedIcon className="size-3.5 shrink-0 text-muted-fg" />
        ) : null}
        <input
          value={query}
          placeholder={placeholder}
          onChange={(e) => typeText(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
          className={cn("w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-fg/60", mono && "font-mono text-xs")}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-muted-fg hover:text-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      {showList && createPortal(
        <ul
          ref={listRef}
          style={{ position: "fixed", top: menuRect.top, left: menuRect.left, width: menuRect.width }}
          className="z-[1000] max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-fg">{emptyHint}</li>
          ) : filtered.map((o) => {
            const Icon = o.icon;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
                    o.disabled
                      ? "cursor-not-allowed text-muted-fg/60"
                      : "hover:bg-accent hover:text-accent-fg",
                    o.value === value && !o.disabled && "bg-accent/50",
                  )}
                >
                  {Icon && <Icon className="size-3.5 shrink-0 text-muted-fg" />}
                  <span className={cn("truncate", mono && "font-mono text-xs")}>{o.label || o.value}</span>
                  {o.hint && <span className="ml-auto shrink-0 text-[10px] text-muted-fg">{o.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
