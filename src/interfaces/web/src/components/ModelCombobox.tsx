import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

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

  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

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
          <span title={invalidHint || "Modelo/proveedor no disponible"}>
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

      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ring-1 ring-foreground/10">
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
        </ul>
      )}
    </div>
  );
}
