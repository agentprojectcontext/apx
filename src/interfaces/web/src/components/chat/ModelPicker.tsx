import { useEffect, useMemo, useRef, useState } from "react";
import { Server, ChevronDown, X, Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { useModelCatalog } from "../agents/modelCatalog";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";

// Compact model picker for the chat composer (the panda.project pattern): a
// small "Server · <model>" button that opens a dropdown to pick a model
// override, or fall back to "Auto" (the daemon's fallback router decides).
//
// Options come from the shared catalog (components/agents/modelCatalog): the
// providers this install has switched ON, each asked for its own model list.
// Empty value = Auto.
//
// It used to build the list itself, from `GET /engines` — the ADAPTER ids the
// build ships, not the providers the user configured. Three things went wrong
// with that, all of them invisible:
//   • it probed providers by adapter id, with no slug and no base_url, so the
//     daemon looked for the key under the wrong name and asked Ollama at
//     localhost — while this install runs it on another machine entirely;
//   • it probed providers the user had switched off, and could never probe one
//     configured under a slug of its own;
//   • it prefixed `engine:` only when the id had no colon — and every Ollama id
//     has one, so `gemma3:4b` was offered whole and read back as the provider
//     "gemma3", which resolves to nothing.
// The catalog is asked lazily, on open, so a mounted composer costs no requests.
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
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Nothing is fetched until the picker is opened for the first time.
  const { providers, loading, probing } = useModelCatalog({ enabled: open });

  // Flat `<provider>:<model>` ids, kept in catalog order: providers as
  // configured, and within each one its default model first.
  const options = useMemo(() => {
    const seen = new Set<string>();
    for (const p of providers) for (const m of p.models) seen.add(`${p.slug}:${m}`);
    return [...seen];
  }, [providers]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const busy = loading || probing;
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const label = value || t("shared_ui.auto");

  const pick = (m: string) => { onChange(m); setOpen(false); setQuery(""); };

  return (
    <div ref={wrapRef} className="relative">
      <Tip content={t("chat_ui.pick_model")}>
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
          aria-label={t("chat_ui.pick_model")}
        >
          <Server className="size-3 shrink-0" />
          <span className="truncate font-mono">{label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </Tip>

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
            {busy && options.length === 0 && (
              <li className="px-2 py-1 text-[11px] text-muted-fg">{t("shared_ui.loading_models")}</li>
            )}
            {!busy && filtered.length === 0 && query.trim() && (
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
