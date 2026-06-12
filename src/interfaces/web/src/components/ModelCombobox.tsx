import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { t } from "../i18n";

// Editable combobox: type freely, matching options appear below; click one to
// pick it, or keep your own text. Behaves like a text input that is also a
// select (the panda.project model picker pattern).
export function ModelCombobox({
  value,
  onChange,
  options,
  placeholder = "elegí o escribí un modelo…",
  invalid,
  invalidHint,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  invalid?: boolean;
  invalidHint?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

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
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // If the visible text matches the committed value, the user hasn't typed
  // anything new yet — show the full list so they can see every option.
  // Only narrow when they actively start filtering.
  const q = query.trim().toLowerCase();
  const isUntouched = query === value;
  const filtered = q && !isUntouched ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  const pick = (o: string) => { onChange(o); setQuery(o); setOpen(false); };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-lg border bg-background px-2.5 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
          invalid ? "border-amber-500/60" : "border-border",
        )}
      >
        {invalid && (
          <span title={invalidHint || t("models_ui.invalid_hint")}>
            <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
          </span>
        )}
        <input
          value={query}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-fg/60"
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

      {open && filtered.length > 0 && menuRect && createPortal(
        <ul
          ref={listRef}
          style={{ position: "fixed", top: menuRect.top, left: menuRect.left, width: menuRect.width }}
          className="z-[1000] max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
        >
          {filtered.map((o) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-fg",
                  o === value && "bg-accent/50",
                )}
              >
                <span className="truncate font-mono text-xs">{o}</span>
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
