import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge, Input, Switch } from "../ui";
import { StatusDot } from "../Section";
import { cn } from "../../lib/cn";
import type { EmbedEngineInfo } from "../../lib/api/embeddings";
import { t } from "../../i18n";

// Embeddings engine list — an ordered fallback chain (router), the mirror of the
// Voice (TTS) provider list. Arrows reorder the chain, the switch enables/disables
// an engine, and each row picks that provider's EMBEDDING model right here — the
// API key is reused from Engines & models, so there is nothing to re-declare.
// The first AVAILABLE enabled engine in the order does the embedding. `tf` (the
// offline bag-of-words fallback) is pinned last and always on — the guarantee the
// retriever never throws, not a choice. Data from the daemon (/embeddings/providers).

const META: Record<string, { name: string; modelPlaceholder?: string; note: string; local?: boolean }> = {
  ollama: { name: "Ollama", modelPlaceholder: "nomic-embed-text", note: "local · key-free", local: true },
  gemini: { name: "Gemini", modelPlaceholder: "text-embedding-004", note: "key from Engines & models" },
  openai: { name: "OpenAI", modelPlaceholder: "text-embedding-3-small", note: "key from Engines & models" },
  tf: { name: "Offline (tf)", note: "bag-of-words · low quality", local: true },
};

interface Props {
  engines: EmbedEngineInfo[];
  order: string[]; // effective chain order from the daemon (tf last)
  models: Record<string, string>; // current embedding model per provider id
  busy?: boolean;
  onReorder: (nextOrder: string[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onSetModel: (id: string, model: string) => void;
}

export function EmbedProviderList({
  engines,
  order,
  models,
  busy,
  onReorder,
  onToggleEnabled,
  onSetModel,
}: Props) {
  const byId = new Map(engines.map((e) => [e.id, e]));
  // Reorderable engines only — tf is pinned last and shown separately.
  const ids = [
    ...order.filter((id) => byId.has(id) && id !== "tf"),
    ...engines.map((e) => e.id).filter((id) => id !== "tf" && !order.includes(id)),
  ];
  const tf = byId.get("tf");

  const move = (id: string, dir: -1 | 1) => {
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    onReorder(reordered);
  };

  const row = (id: string, idx: number | null, pinned: boolean) => {
    const e = byId.get(id)!;
    const meta = META[id] || { name: id, note: "" };
    return (
      <div
        key={id}
        data-testid={`embed-provider-${id}`}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5",
          !e.enabled && !pinned && "opacity-60",
        )}
      >
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => idx !== null && move(id, -1)}
            disabled={busy || pinned || idx === 0}
            aria-label={t("memory_panel.move_up")}
            data-testid={`embed-provider-${id}-up`}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => idx !== null && move(id, 1)}
            disabled={busy || pinned || idx === ids.length - 1}
            aria-label={t("memory_panel.move_down")}
            data-testid={`embed-provider-${id}-down`}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>

        <StatusDot ok={e.available ? true : e.configured ? false : null} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{meta.name}</span>
            {meta.local && <Badge tone="info">{t("memory_panel.badge_local")}</Badge>}
            {e.available ? (
              <Badge tone="success">{t("memory_panel.available")}</Badge>
            ) : e.configured ? (
              <Badge tone="warning">{t("memory_panel.unavailable")}</Badge>
            ) : (
              <Badge tone="muted">{t("memory_panel.not_configured")}</Badge>
            )}
          </div>
          {pinned ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta.note}</div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("memory_panel.model_label")}
              </span>
              <Input
                defaultValue={models[id] || ""}
                placeholder={meta.modelPlaceholder}
                disabled={busy}
                onBlur={(ev) => {
                  const v = ev.target.value.trim();
                  if (v !== (models[id] || "")) onSetModel(id, v);
                }}
                className="h-7 max-w-[16rem] font-mono text-xs"
              />
            </div>
          )}
        </div>

        {pinned ? (
          <span className="shrink-0 text-xs text-muted-foreground">{t("memory_panel.always_on")}</span>
        ) : (
          <Switch checked={e.enabled} onChange={(v) => onToggleEnabled(id, v)} disabled={busy} />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {ids.map((id, idx) => row(id, idx, false))}
      {tf && row("tf", null, true)}
    </div>
  );
}
