import { useEffect, useRef, useState } from "react";
import { Server, ChevronDown, X, Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { Engines } from "../../lib/api";
import { t } from "../../i18n";

// Compact model picker for the chat composer (the panda.project pattern): a
// small "Server · <model>" button that opens a dropdown to pick a model
// override, or fall back to "Auto" (the daemon's fallback router decides).
//
// Options are the live model catalogs of the configured engines, aggregated as
// `engine:model` (best-effort — engines that fail to list are skipped). Empty
// value = Auto.
export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Lazily load the aggregated model catalog the first time the picker opens.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { engines } = await Engines.list();
        const lists = await Promise.all(
          engines.map((e) =>
            Engines.models({ engine: e })
              .then((r) => (r.models || []).map((m) => (m.includes(":") ? m : `${e}:${m}`)))
              .catch(() => [] as string[]),
          ),
        );
        if (!cancelled) {
          const flat = Array.from(new Set(lists.flat())).sort();
          setOptions(flat);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, loaded]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const label = value || t("shared_ui.auto");

  const pick = (m: string) => { onChange(m); setOpen(false); setQuery(""); };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="chat-model-picker"
        className={cn(
          "flex max-w-[200px] items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors",
          "hover:bg-accent/60 hover:text-foreground",
          value && "text-foreground",
        )}
        title={t("chat_ui.pick_model")}
        aria-label={t("chat_ui.pick_model")}
      >
        <Server className="size-3 shrink-0" />
        <span className="truncate font-mono">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-md ring-1 ring-foreground/10">
          <input
            autoFocus
            value={query}
            placeholder={t("shared_ui.model_filter_ph")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) pick(query.trim()); }}
            className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground/30"
          />
          <ul className="max-h-56 overflow-y-auto">
            <li>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(""); }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-fg",
                  !value && "bg-accent/50",
                )}
              >
                <span className="flex items-center gap-1.5"><X className="size-3" /> {t("shared_ui.auto_router")}</span>
                {!value && <Check className="size-3" />}
              </button>
            </li>
            {!loaded && <li className="px-2 py-1 text-[11px] text-muted-fg">{t("shared_ui.loading_models")}</li>}
            {loaded && filtered.length === 0 && query.trim() && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(query.trim()); }}
                  className="w-full rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent hover:text-accent-fg"
                >
                  {t("shared_ui.use_value", { value: query.trim() })}
                </button>
              </li>
            )}
            {filtered.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent hover:text-accent-fg",
                    m === value && "bg-accent/50",
                  )}
                >
                  <span className="truncate">{m}</span>
                  {m === value && <Check className="size-3 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
