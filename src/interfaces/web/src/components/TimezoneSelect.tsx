import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import type { TzOption } from "../i18n/timezones";

// Searchable timezone picker. Shows offset-prefixed labels
// ("(GMT-03:00) America/Argentina/Buenos_Aires"), filters as you type, and
// commits the raw IANA value. Mirrors the ModelCombobox portal pattern so the
// list escapes any scrolling container.
export function TimezoneSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: TzOption[];
  placeholder?: string;
  className?: string;
}) {
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(labelFor(value));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => { setQuery(labelFor(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value, options]);

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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setQuery(labelFor(value)); // discard half-typed query on outside click
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, value, options]);

  const q = query.trim().toLowerCase();
  const isUntouched = query === labelFor(value);
  const filtered = q && !isUntouched
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  const pick = (o: TzOption) => { onChange(o.value); setQuery(o.label); setOpen(false); };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="flex items-center gap-1 rounded-lg border border-input bg-transparent px-2.5 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring dark:bg-input/30 dark:hover:bg-input/50">
        <input
          value={query}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
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
          className="z-[1000] max-h-60 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10"
        >
          {filtered.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-fg",
                  o.value === value && "bg-accent/50",
                )}
              >
                <span className="truncate font-mono text-xs">{o.label}</span>
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
