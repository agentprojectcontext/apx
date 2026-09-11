import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

/** A choice: the value that gets stored, and the line the list shows. */
export interface SearchOption { value: string; label: string }

/** Accent-blind, case-blind. Typing "mex" has to find "Español (México)" and
 *  "peru" has to find "América/Lima" — writing the accent is precisely what
 *  someone searching a 400-row list does not stop to do. Without this the
 *  locale picker answered "mex" with an empty list, which reads as "that one
 *  does not exist". */
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Searchable picker for a LONG list — the ones a dropdown cannot hold: every
// IANA timezone ("(GMT-03:00) America/Argentina/Buenos_Aires"), every locale
// ("es-AR · Español (Argentina)"). Filters on both the label and the raw value
// as you type, and commits the raw value. Mirrors the ModelCombobox portal
// pattern so the list escapes any scrolling container.
//
// Was TimezoneSelect, and only zones; the locale list needed the same thing and
// a second copy of a portalled combobox is how two pickers start behaving
// differently.
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  className?: string;
}) {
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(labelFor(value));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // labelFor is rebuilt every render and only reads `options`, which is already
  // a dependency — listing it too would re-run this on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setQuery(labelFor(value)); }, [value, options]);

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

  const q = fold(query.trim());
  const isUntouched = query === labelFor(value);
  const filtered = q && !isUntouched
    ? options.filter((o) => fold(o.label).includes(q) || fold(o.value).includes(q))
    : options;

  const pick = (o: SearchOption) => { onChange(o.value); setQuery(o.label); setOpen(false); };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="flex items-center gap-1 rounded-lg border border-input bg-transparent px-2.5 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring dark:bg-input/30 dark:hover:bg-input/50">
        <input
          value={query}
          // While focused the box is a SEARCH box, so the current choice moves
          // to the placeholder and stays readable behind it.
          placeholder={(open ? labelFor(value) : "") || placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          // Clear on focus, and do not try to be clever with select-all: the
          // box holds the current choice, and clicking into it used to drop the
          // caret mid-label so typing INSERTED there —
          // "es-AR · Español (Argentimexna)", which matches nothing and reads
          // as a broken picker. (select() loses to the same click placing the
          // caret right after it.) Clearing shows the whole list, which is what
          // clicking a picker means.
          onFocus={() => { setOpen(true); setQuery(""); }}
          // Tabbing away is the other way out: the outside-click handler never
          // fires for it, so the box would keep a half-typed query forever.
          onBlur={() => { setQuery(labelFor(value)); setOpen(false); }}
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
